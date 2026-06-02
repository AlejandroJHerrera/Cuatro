# Payment Pivot — Bank-Transfer Screenshots + AI Verification + QR Check-In

**Date:** 2026-06-02
**Status:** Design — awaiting user review
**Supersedes:** Stripe Checkout flow in HANDOFF.md "Payment blocker" section

## Context

Stripe does not operate in Honduras, so the previously-coded `/api/checkout` flow is sterile. This spec replaces it with a bank-transfer flow: the customer uploads a screenshot of their transfer, an LLM verifier checks it synchronously, and on approval the backend converts seat holds to tickets and emails signed QR codes. Door staff scan QRs through a new admin surface.

This spec covers backend + frontend changes end-to-end. It does not cover deployment, the choice of bank, or post-show analytics.

## Goals

- Customer can complete a purchase in under ~60s on a phone, end-to-end.
- Verification is automatic by default; humans only intervene on the soft-cap async path.
- Payment screenshots are never written to disk or persisted in the database.
- Door staff can scan a QR and get a green/yellow/red verdict in under 1s.
- Admins can fall back to manual check-in if a phone is dead.

## Non-goals

- Multiple payment methods (one bank account for v1).
- Refund flow.
- Offline scanner mode.
- QR rotation / secret rotation (one show, one secret).
- I18n beyond Spanish.

## High-level flow

```
Customer                        Cuatro backend                    LLM           Resend
   │                                  │                              │              │
   ├── pick seats (holds live) ──────▶│                              │              │
   ├── upload screenshot ────────────▶│ multer memoryStorage         │              │
   │     POST /api/checkout/verify    │ (never hits disk)            │              │
   │                                  ├──── verify(img + meta) ─────▶│              │
   │                                  │◀──── verdict + reasons ──────│              │
   │                                  ├── archive email + attachment ───────────────▶│  → pagos inbox
   │                  ┌───── if APPROVE ─────┐                                       │
   │                  │ • holds → Tickets    │                                       │
   │                  │ • Order.status=paid  │                                       │
   │                  │ • generate 1 signed  │                                       │
   │                  │   QR per seat        │                                       │
   │                  │ • drop screenshot    │                                       │
   │                  └──────────────────────┘                                       │
   │                                  ├── confirmation email + N QR PNGs ───────────▶│  → customer
   │◀── 200 {orderCode} ──────────────│
   │── hard-nav /success?order=… ────▶│
   │                  ┌──── if REJECT ────┐
   │                  │ • holds untouched │
   │                  │ • attempts++       │
   │                  │ • drop screenshot │
   │                  └────────────────────┘
   │◀── 422 {reason, attemptsLeft} ───│

Door night:
Door staff /admin/scan ───── POST /api/admin/scan {payload} ─────▶ verify sig, mark redeemedAt
```

### Invariants

- **Screenshot lives in memory only.** `multer.memoryStorage`, buffer passed to LLM + Resend, dropped at request end. No `diskStorage`, no S3, no DB blob.
- **Synchronous verification with a 30s soft cap.** Past 30s the request returns `202 {status:"pending"}`; verification finishes in a detached promise and the customer learns the outcome by email.
- **Holds are the source of truth during verification.** Approval converts them to tickets atomically; rejection leaves them alone for retry.
- **3 attempts per `Order`.** 4th attempt → `410 attempts-exhausted`, holds released, customer bounced to `/seats`.

## Schema changes

One migration: `20260602_payment_pivot`.

```prisma
model Order {
  // existing: id, code, userId, guestName, totalLps, createdAt, status
  // REMOVE: stripeSessionId
  verificationAttempts Int       @default(0)
  verifiedAt           DateTime?
  rejectionReason      String?
}

model Ticket {
  // existing: id, orderId, seatId
  qrPayload      String   @unique         // full signed string encoded in the QR
  redeemedAt     DateTime?
  redeemedBy     String?
  redeemedByUser User?   @relation("Redemptions", fields: [redeemedBy], references: [id])
}

model PaymentReceipt {                     // dedupe only — NO image
  id          String   @id @default(cuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  txnId       String   @unique
  verifiedAt  DateTime @default(now())
}

model User {
  // existing
  role        UserRole @default(customer)
  redemptions Ticket[] @relation("Redemptions")
}

enum UserRole {
  customer
  doorStaff
  admin
}
```

Notes:
- `Order.status` enum is unchanged — `pending → paid` is still the transition. `pending` orders with `verificationAttempts >= 3` are dead and released lazily.
- `Ticket.qrPayload` stores the full signed string so re-sending the email is a pure DB read with no re-signing.
- `UserRole` defaults to `customer` so existing sign-up flow is unchanged. Door staff and admins are promoted manually via Prisma Studio (or a future `/admin/staff` page).

## Endpoints

### Replaces Stripe path

| Method | Path | Notes |
|---|---|---|
| POST | `/api/checkout/verify` | `multipart/form-data` with `screenshot` (PNG/JPG, ≤5MB) and optional `bankRef`. `requireAuth`. See pipeline below. |
| ~~POST `/api/checkout`~~ | — | Deleted. |

**Pipeline for `/api/checkout/verify`:**

1. Load caller's active holds. `410 holds-expired` if missing/expired.
2. Find or create a pending `Order` for the caller. Idempotency key is `(userId, status=pending)` — at most one pending Order per user at a time; if it exists and its seats match the current holds we reuse it, if its seats no longer match the current holds we overwrite its seat snapshot.
3. If `Order.verificationAttempts >= 3` → release the user's holds via the existing `releaseUserHolds` service, return `410 attempts-exhausted`.
4. Call LLM verifier with the screenshot buffer + `{amountLps, accountRef, orderCode, holdCreatedAt}`. Soft cap 30s.
5. **Approve path:**
   - Reject if `PaymentReceipt.txnId` already seen (`422 duplicate-receipt`, attempts++).
   - In one Prisma tx: holds → Tickets, generate signed `qrPayload` per ticket, `Order.status=paid`, `verifiedAt=now()`, insert `PaymentReceipt`.
   - Fire archive email (metadata only) + confirmation email (with N inline QR PNGs).
   - Drop screenshot buffer.
   - Return `200 {status:"approved", orderCode}`.
6. **Reject path:**
   - `verificationAttempts++`, `rejectionReason = verdict.reason`.
   - Fire archive email **with screenshot attached** (helps debug false negatives).
   - Drop buffer.
   - Return `422 {status:"rejected", reason, detail, attemptsLeft}`.
7. **Timeout / pending path (>30s):**
   - Return `202 {status:"pending"}`.
   - Continue verification in a detached promise; the same approve/reject path runs, but the customer learns the outcome via `order-confirmation` or `order-rejection` email rather than the HTTP response.

### New admin/scanner surface

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/scan` | `{payload: string}`. `requireRole(doorStaff \| admin)`. Verifies HMAC, looks up `Ticket` by `qrPayload`, idempotently stamps `redeemedAt`/`redeemedBy`. Returns `{ok:true, seat, guestName, alreadyUsed:false}` or `{ok:true, alreadyUsed:true, redeemedAt, redeemedBy:{name}}`. Bad sig / unknown payload → `400 {ok:false, reason:"invalid"}`. |
| GET | `/api/admin/door` | `requireRole(admin)`. Full door manifest: paid orders with seats + redemption state. |
| POST | `/api/admin/manual-checkin` | `{ticketId}`. `requireRole(admin)`. Fallback when a phone is dead. Same redemption stamp. |

### Helpers

| Method | Path | Notes |
|---|---|---|
| POST | `/api/orders/:code/resend-email` | `requireAuth` + owner check. Re-fires confirmation email from stored `qrPayload`s. |

### Middleware

- `requireAuth` (existing) front of `/api/holds`, `/api/checkout/verify`, `/api/my-tickets`, `/api/orders/*`.
- `requireRole(...roles)` (new) sits on top of `requireAuth` for `/api/admin/*`.

## LLM verifier contract

**Provider:** Claude Sonnet 4.6 (`claude-sonnet-4-6`) via the Anthropic SDK. Vision-capable, ~3–6s typical latency, ~$0.01–0.02 per call. Image goes in as a base64 `image` content block — no Files API.

**Service surface:**

```ts
// backend/src/services/paymentVerifier.ts
type VerifyInput = {
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  expected: {
    amountLps: number;
    accountRef: string;       // env: BANK_ACCOUNT_REF
    orderCode: string;        // for logging only
    holdCreatedAt: Date;
  };
};

type VerifyVerdict =
  | { ok: true;  txnId: string; senderName: string | null }
  | { ok: false; reason:
        "amount-mismatch"
      | "wrong-account"
      | "stale-receipt"
      | "missing-txn-id"
      | "not-a-receipt"
      | "unreadable";
      detail: string;  // short Spanish phrase shown to the user
    };

verifyReceipt(input: VerifyInput): Promise<VerifyVerdict>
```

**Prompt:** Spanish, system + user. System defines the verifier role, the strict hard checks (amount / account / recency / txn-id / is-a-receipt), and instructs the model to emit through a single tool `emit_verdict` whose input schema matches `VerifyVerdict`. Tool use is what guarantees schema-shaped output.

**Hard checks (all required to pass):**
1. Amount on receipt equals `seats × PRICE_PER_SEAT_LPS`.
2. Recipient account matches `BANK_ACCOUNT_REF`.
3. Receipt timestamp is within ~24h of `holdCreatedAt`.
4. Non-empty `txnId` extracted.
5. Image is recognizably a bank/Tigo Money receipt.

Sender name (`senderName`) is a soft signal — logged for door staff, never auto-rejects.

**Failure modes the service handles:**
- Network/timeout → throws → caller treats as `pending` (the 30s path).
- Malformed tool response → throws → caller treats as `rejected` with reason `unreadable`, attempt counted.
- `txnId` already in `PaymentReceipt` → caller rejects with `duplicate-receipt` *before* honoring the verdict.

**Test seam:** verifier is a single function behind an interface. Integration tests use a `FakeVerifier` returning canned verdicts.

## QR signing scheme

**Payload format:**

```
cuatro:1:<orderCode>:<seatId>:<sigB64url>
```

- `1` is the scheme version — lets us roll the format later.
- `<orderCode>` is the 6-char nanoid.
- `<seatId>` is the seat label (e.g. `A7`).
- `<sigB64url>` is `HMAC-SHA256(secret, "cuatro:1:<orderCode>:<seatId>")`, base64url, no truncation (43 chars).

**Why HMAC, not JWT:** no expiry needed, no claims, no algorithm-confusion attacks. ~50-byte string scans faster than a JWT and keeps the QR low-density.

**Secret:**
- `QR_SIGNING_SECRET` env var, 32 random bytes hex-encoded.
- Generated once via `openssl rand -hex 32`, committed to `.env` (not `.env.example`).
- Validated in `env.ts` (zod, min 64 hex chars).
- No rotation story for v1.

**Verification (in `/api/admin/scan`):**

```ts
function verify(payload: string): { orderCode: string; seatId: string } | null {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "cuatro" || parts[1] !== "1") return null;
  const [, , orderCode, seatId, sig] = parts;
  const expected = hmac(secret, `cuatro:1:${orderCode}:${seatId}`);
  if (!timingSafeEqual(sig, expected)) return null;
  return { orderCode, seatId };
}
```

Route then looks up `Ticket` by `qrPayload` (unique index), stamps `redeemedAt`/`redeemedBy`, returns idempotent response.

**QR rendering:** `qrcode` npm package, PNG at ~512×512, error-correction level **M**. One PNG per ticket. Same renderer powers the inline `<img cid:>` in the confirmation email and the on-screen QR on `/success` (so customers can scan from their phone screen without opening email).

## Frontend surfaces

### `/checkout` — rebuilt

Reads `?seats&expires` as before. The PAGAR CTA is replaced by:

1. **Payment instructions card** — Marquee-framed, mono. Bank name, account holder, account number, exact amount in LPS, and `REFERENCIA: <orderCode>`. Copy-to-clipboard chips for account number and amount. The `orderCode` is allocated on first arrival to `/checkout` (idempotent for the same hold set).
2. **Upload block** — `SUBIR COMPROBANTE` file input (PNG/JPG ≤5MB, client-side validated). After file pick: thumbnail + filename + `VERIFICAR PAGO →` CTA. On submit:
   - Replace form with centered `Verificando comprobante…` skeleton + animated marquee bulb.
   - 30s client soft cap; past 30s, flip to `Estamos revisando tu pago — te avisaremos por correo` with a link back to `/`.
   - `200 approved` → hard-nav to `/success?order=<code>`.
   - `422 rejected` → inline alert with `verdict.detail` in Spanish + `SUBIR OTRO COMPROBANTE` button + `Intentos restantes: N`.
   - `410 attempts-exhausted` → bounce to `/seats` with flash message.

`HoldTimer` keeps ticking. If holds expire mid-verification, treat as `pending` (email path).

### `/success` — adjustments

- Each `TicketStub` gains the QR PNG (server-rendered, embedded as data URL).
- `ResendEmailButton` flips from mock to real `POST /api/orders/:code/resend-email`.

### `/admin/scan` — new, phone-first

`requireRole(doorStaff | admin)`. Single screen:
- Camera viewfinder via `react-qr-reader` (or `jsQR` over `getUserMedia`).
- On scan: POST `/api/admin/scan`, show full-screen verdict for ~1.5s:
  - **Green** `LIBRE` + seat ID + guest name.
  - **Yellow** `YA ESCANEADO` + when + by whom.
  - **Red** `INVÁLIDO` + reason.
- Bottom strip: last 5 scans with colored dots.
- `MODO MANUAL →` link to `/admin/door`.

### `/admin/door` — new, admin-only

`requireRole(admin)`. Phone/tablet manifest:
- Header counters: `TOTAL VENDIDAS · X / 121`, `ESCANEADAS · Y / X`.
- Searchable list (by guest name or order code). Each row: name, code, seat IDs with per-seat green/grey dots, total.
- Expanded row: `MARCAR ENTRADA ✓` button per unscanned seat → `/api/admin/manual-checkin`.

### `/cancel`

Stays. Stripe-cancel framing in copy goes away.

## Email templates (Resend)

- **`payment-archive.tsx`** — to `pagos@cuatro…`. Subject `[CUATRO] <orderCode> · L<amount> · <guestName>`. Body: order metadata + verdict + reason. Screenshot attached **only on reject** (debug aid).
- **`order-confirmation.tsx`** — to customer. Subject `Tu reservación CUATRO · <orderCode>`. Body: thank-you in PRODUCT.md voice + per-seat block with inline QR + showtime + venue + name-at-door.
- **`order-rejection.tsx`** — to customer, only on the async-pending path. Subject `No pudimos verificar tu pago · <orderCode>`. Body: reason in Spanish + retry link to `/checkout?retry=<orderCode>` (uses one of the remaining attempts) + support email.

## Env vars added

| Var | Purpose |
|---|---|
| `QR_SIGNING_SECRET` | 32-byte hex, HMAC key for QR payloads. |
| `BANK_ACCOUNT_REF` | Human-readable account identifier shown to customer + checked by LLM. |
| `PAYMENT_ARCHIVE_EMAIL` | Internal inbox that receives archive emails. |
| `ANTHROPIC_API_KEY` | LLM verifier. |
| `RESEND_API_KEY` | Email transport. |

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are removed.

## Stripe debris to remove

- `backend/src/services/checkout.ts`, `backend/src/routes/checkout.ts` — replaced by `paymentVerifier.ts` + new route.
- `Order.stripeSessionId` column — dropped in migration.
- `stripe` npm dep in `backend/package.json` (`nanoid` stays).
- Stripe MCP plugin — uninstall.
- Stripe references in `HANDOFF.md` "Payment blocker" section.
- Test secret in `backend/.env` — roll at the Stripe dashboard before deletion.

## Testing strategy

- **Unit:** `signQrPayload` / `verifyQrPayload` round-trip; `verifier` schema parsing; `requireRole` middleware.
- **Integration (with `FakeVerifier`):** approve path commits Tickets + PaymentReceipt + Order.status=paid; reject path leaves holds alone and increments attempts; 4th attempt returns 410 + releases holds; duplicate `txnId` rejected; admin scan idempotency.
- **Manual:** real end-to-end with a sandbox Resend domain and one real screenshot for the LLM.

## Open questions for the user

None for v1. Items intentionally deferred:
- Bank choice / `BANK_ACCOUNT_REF` content (operational, not design).
- Door staff onboarding UX beyond manual Prisma Studio promotion.
- Refund / order-cancel flow for the support inbox.
