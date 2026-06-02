# Session Handoff — Cuatro Ticketing Site

Drop this file (plus `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in the same directory) into a new Claude Code session and paste this line as your first message:

> Read `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in this directory and continue from where the previous session left off.

---

## What this project is

A production web app to sell tickets to a **single movie function**: a documentary screening for the album **"CUATRO"** by **Jose Javier Diaz** (4 tracks named after seasons + cardinal directions).

- **Venue (placeholder, swap when finalized):** Cinepolis Altara, San Pedro Sula, Honduras (SALA 4 — irregular 121-seat house).
- **Showtime (placeholder):** 27 June 2026, 6:00 PM.
- **Audience:** Spanish-speaking music + film fans, mostly arriving on phones from a shared link.
- **Flow:** sign in (Google OAuth or email + password) → pick seats on an interactive map → confirm reservation → **bank-transfer screenshot upload, AI-verified by Claude Sonnet 4.6** → emailed confirmation with per-seat signed QR codes → door staff scan QRs at the door (with manual check-in fallback).

Project root: `/Users/alejandro/Desktop/Cuatro/`

## Stack (locked in)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first via `@theme`) + a handful of `@utility` directives |
| Fonts | Fraunces (display serif), DM Sans (body), JetBrains Mono (operational), all via `next/font/google` |
| Backend | Express 5 + TypeScript on `:4000` |
| Database | PostgreSQL 16 via Prisma 5.22 — `docker compose up -d` on host port **5433** |
| Auth | Google OAuth + email/password via Passport.js + Postgres-backed session cookie. Google strategy registered conditionally on `GOOGLE_CLIENT_ID/SECRET`. |
| Payments | **Bank transfer + Claude Sonnet 4.6 verification.** Customer uploads a receipt screenshot to `POST /api/checkout/verify`; the route calls the Anthropic SDK (`@anthropic-ai/sdk`) with the image, validates via single-tool-use, converts holds → Tickets, and emits HMAC-SHA256-signed QR payloads. Screenshots are never persisted (multer `memoryStorage`). |
| Email | Resend + `@react-email/components`. Three templates: customer confirmation (with inline QR PNGs), internal payment archive, customer rejection. |
| Door entry | Per-seat HMAC-signed QR codes, scanned by door staff via `/admin/scan` (jsqr camera viewfinder). Admins fall back to manual check-in on `/admin/door`. |
| Testing | Vitest + supertest backend harness. 25 tests across 8 files. Truncating Postgres `cuatro_test` DB on `:5433`. |

Max seats per order: **8**. Price: **L 12.00** per seat. Constants in [`frontend/lib/seats.ts`](frontend/lib/seats.ts): `PRICE_PER_SEAT_LPS`, `formatTotalLPS`, `formatPriceLPS`.

## Design system (impeccable workflow)

Followed the `impeccable` plugin workflow: `teach` → `document --seed` → `shape` → `craft`. Three context files at the project root drive everything downstream:

- **[PRODUCT.md](PRODUCT.md)** — strategic doc. Touchstones: **MUBI** + **Metrograph**. Principles include "the seat map is the centerpiece", "one night, one room", "restraint over atmosphere", "Spanish-first never translated-feeling", "treat the purchase like an RSVP".
- **[DESIGN.md](DESIGN.md)** — seed visual system. North Star: **"The Late-Night Marquee"**. Color strategy: **Restrained** (tinted near-blacks + Marquee Gold ≤5%).
- **[PLAN.md](PLAN.md)** — original 10-phase implementation plan (now superseded by the payment-pivot plan for phases 5–6).
- **[docs/superpowers/specs/2026-06-02-payment-pivot-design.md](docs/superpowers/specs/2026-06-02-payment-pivot-design.md)** — design spec for the bank-transfer + AI-verification + QR flow.
- **[docs/superpowers/plans/2026-06-02-payment-pivot.md](docs/superpowers/plans/2026-06-02-payment-pivot.md)** — 19-task implementation plan (all tasks landed in this session).

OKLCH tokens, fonts, motion tokens, and hero-blend utilities live in [`frontend/app/globals.css`](frontend/app/globals.css) under `@theme` + `@utility`.

## Backend layout (current)

```
backend/
├── docker-compose.yml              (at project root) Postgres 16 on host :5433
├── package.json                    tsx watch dev script + prisma + vitest scripts
│                                   deps: express 5, prisma 5.22, passport, bcryptjs,
│                                   multer, qrcode, resend, @react-email/components,
│                                   @anthropic-ai/sdk, react/react-dom (for emails),
│                                   nanoid, zod, helmet, cors
├── vitest.config.ts                Loads .env.test, single-fork, fileParallelism:false
├── .env.test                       Test env with fake API keys + cuatro_test DB
├── prisma/
│   ├── schema.prisma               Final schema (see "Schema highlights" below)
│   ├── seed.ts                     Idempotent — upserts 1 Movie + 121 Seats
│   └── migrations/
│       ├── 20260520061159_init/
│       ├── 20260520061602_movie_fields/
│       ├── 20260521120000_order_code/    Order.code (6-char human-readable)
│       └── 20260602120000_payment_pivot/ Drop Stripe; add Ticket QR fields,
│                                          Order verification fields, PaymentReceipt,
│                                          User.role + UserRole enum
└── src/
    ├── index.ts                    Express bootstrap (helmet, CORS, sessions, passport).
    │                               Mounts /api/movie, /api/seats, /api/holds,
    │                               /api/my-tickets, /api/checkout, /api/orders,
    │                               /api/admin, plus authRouter at /api.
    ├── env.ts                      zod-validated env. Hard-requires QR_SIGNING_SECRET,
    │                               BANK_ACCOUNT_REF, PAYMENT_ARCHIVE_EMAIL,
    │                               ANTHROPIC_API_KEY, RESEND_API_KEY.
    ├── db.ts                       Prisma client singleton (dev HMR-safe)
    ├── auth/
    │   ├── session.ts              express-session + connect-pg-simple
    │   ├── passport.ts             Google strategy (conditional on env)
    │   ├── routes.ts               /auth/signup, /signin, /logout, /me (returns role),
    │   │                            /auth/google[/callback], exports requireAuth.
    │   ├── requireRole.ts          requireRole(...roles) middleware factory
    │   └── requireRole.test.ts
    ├── routes/
    │   ├── movie.ts                GET /api/movie
    │   ├── seats.ts                GET /api/seats
    │   ├── holds.ts                POST/DELETE /api/holds, GET /api/holds/me
    │   ├── myTickets.ts            GET /api/my-tickets (paid orders w/ tickets[] + code + qrPayload)
    │   ├── checkoutVerify.ts       POST /api/checkout/verify — multer in-memory upload,
    │   │                            verifier injection, 30s soft cap, archive + emails.
    │   ├── checkoutVerify.test.ts  4 tests (approve / reject / attempts-exhausted / no-holds)
    │   ├── orders.ts               POST /api/orders/pending (idempotent find-or-create)
    │   │                            + POST /api/orders/:code/resend-email
    │   ├── admin.ts                POST /api/admin/scan, GET /api/admin/door,
    │   │                            POST /api/admin/manual-checkin (all role-gated)
    │   └── admin.test.ts           4 tests (valid / already-used / tampered / wrong-role)
    ├── services/
    │   ├── movie.ts                Projects Movie row + computes status
    │   ├── seatStatus.ts           Joins Ticket + SeatHold, lazily purges expired holds
    │   ├── holds.ts                replaceUserHolds / releaseUserHolds / getUserHolds
    │   ├── orders.ts               findOrCreatePendingOrder, incrementOrderAttempts,
    │   │                            finalizeOrderAsPaid (serializable tx)
    │   ├── orders.test.ts          4 tests
    │   ├── qrSigning.ts            signQrPayload / verifyQrPayload (HMAC-SHA256, base64url)
    │   ├── qrSigning.test.ts       5 tests
    │   ├── qrRender.ts             renderQrPng(payload) → Buffer (PNG, 512×512, ECC=M)
    │   ├── qrRender.test.ts        1 test
    │   ├── paymentVerifier.ts      PaymentVerifier interface, FakeVerifier (tests),
    │   │                            ClaudeVerifier (Sonnet 4.6 vision + single-tool emit_verdict)
    │   ├── paymentVerifier.test.ts 3 tests
    │   └── email.ts                Resend wrapper: sendOrderConfirmation, sendPaymentArchive,
    │                                sendOrderRejection
    ├── emails/
    │   ├── OrderConfirmationEmail.tsx   Customer email with inline cid:qr-A7 images
    │   ├── PaymentArchiveEmail.tsx      Internal email; screenshot attached only on reject
    │   └── OrderRejectionEmail.tsx      Customer email for the async-pending reject path
    ├── test/
    │   ├── setup.ts                Truncates 7 tables before each test (FK-safe order)
    │   ├── factories.ts            makeUser/makeMovie/makeSeats/makeHold
    │   └── setup.test.ts           Smoke test
    └── types/express.d.ts          Augments Express.User with Prisma User
```

### Schema highlights

- **`User.role`** (`customer | doorStaff | admin`) — defaults to `customer`. Door staff and admins are promoted manually via Prisma Studio. Door scanner and `/admin/door` are gated on this.
- **`Order.code`** — 6-char nanoid using alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Public identifier on stubs + URLs. The cuid `id` is still the FK.
- **`Order.verificationAttempts/verifiedAt/rejectionReason`** — track the 3-attempt cap and the latest LLM verdict for support context.
- **`Ticket.qrPayload`** — full HMAC-signed payload (`cuatro:1:<code>:<seat>:<sig>`), unique. Stored so re-sending the email is a pure DB read.
- **`Ticket.redeemedAt` + `redeemedBy`** — door-redemption audit trail. `redeemedBy → User` is the staff member who scanned.
- **`PaymentReceipt`** — `(orderId UNIQUE, txnId UNIQUE)`. Dedupes receipt screenshots across orders. Image bytes never stored — only the txnId extracted by the LLM.
- **`Movie`** carries the full frontend contract: `director`, `runtimeMin`, `language`, `year`, `venueName`, `venueAddress`, `priceLps`.
- **`Seat.kind`** (`standard | accessible`) — mirrors frontend semantics.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Pings the DB. |
| GET | `/api/movie` | `MovieDTO` for the frontend. |
| GET | `/api/seats` | 121 `{id,row,num,col,kind,status}` rows; expired holds purged. |
| POST | `/api/auth/signup` | `{name,email,password}`. bcrypt-12, 409 on dup, 400 on weak. |
| POST | `/api/auth/signin` | `{email,password}`. 401 on bad creds (intentionally ambiguous). |
| POST | `/api/auth/logout` | Destroys session, clears cookie. |
| GET | `/api/me` | `{user}` (now includes `role`) or 401. |
| GET | `/api/auth/google[/callback]` | OAuth (503 until env keys set). |
| POST | `/api/holds` | Replace-semantics, returns `{seatIds, expiresAt}`. 409 conflict / 404 missing / 409 sold. Behind `requireAuth`. |
| DELETE | `/api/holds` | Release caller's holds. |
| GET | `/api/holds/me` | Restore selection on `/seats` SSR. |
| GET | `/api/my-tickets` | Paid orders w/ `{code, tickets[]: {seat, qrPayload}, status, totalLps, ...}`. `requireAuth`. |
| POST | `/api/checkout/verify` | Multipart `screenshot` (PNG/JPG ≤5MB). Routes through `findOrCreatePendingOrder` → `ClaudeVerifier` → on approve: `finalizeOrderAsPaid` (Tickets + PaymentReceipt + Order.status=paid) + confirmation email with QR PNGs + archive email. 200 approved / 422 rejected `{reason, detail, attemptsLeft}` / 410 `holds-expired` or `attempts-exhausted` / 202 pending (>30s soft cap). `requireAuth`. |
| POST | `/api/orders/pending` | `{totalLps, guestName}` → `{code}`. Idempotent per (userId, status=pending). Used by `/checkout` SSR. `requireAuth`. |
| POST | `/api/orders/:code/resend-email` | Re-sends confirmation with QRs. Owner-checked + 409 if not paid. `requireAuth`. |
| POST | `/api/admin/scan` | `{payload}` → verifies HMAC, stamps `redeemedAt/redeemedBy`, returns `{ok, seat, guestName, alreadyUsed}`. 400 invalid. Role `doorStaff` or `admin`. |
| GET | `/api/admin/door` | Full manifest `{totals, orders:[{code, guestName, totalLps, tickets:[{id,seat,redeemedAt}]}]}`. Role `admin`. |
| POST | `/api/admin/manual-checkin` | `{ticketId}`. Same redemption stamp as scan. Role `admin`. |

## Frontend layout

```
frontend/
├── app/
│   ├── layout.tsx
│   ├── globals.css                 @theme tokens + utilities + scan-fadeout keyframe
│   ├── page.tsx                    Landing
│   ├── seats/page.tsx              Seat picker server entry
│   ├── checkout/page.tsx           Bank-transfer instructions surface
│   ├── success/page.tsx            Per-seat ticket stubs + per-seat QR
│   ├── my-tickets/page.tsx         Order history
│   ├── signin/page.tsx             Google + email/password
│   ├── cancel/page.tsx             Active / expired hold variants
│   ├── admin/
│   │   ├── scan/                   ⭐ Door-staff camera viewfinder + verdict overlay
│   │   │   ├── page.tsx
│   │   │   └── ScanClient.tsx
│   │   └── door/                   ⭐ Admin manifest + manual check-in
│   │       ├── page.tsx
│   │       └── DoorClient.tsx
│   └── components/
│       ├── Header.tsx / SeatsHeader.tsx
│       ├── Hero.tsx / CoverArt.tsx
│       ├── ProgrammerNote.tsx / Tracklist.tsx / Footer.tsx
│       ├── ErrorFallback.tsx
│       ├── SeatPickerApp.tsx / SeatGrid.tsx / SeatLegend.tsx / HoldTimer.tsx
│       ├── CartPanel.tsx
│       ├── CheckoutClient.tsx              ⭐ Uploader + verifying/soft-cap states
│       ├── PaymentInstructionsCard.tsx     ⭐ Account/amount/REFERENCIA with copy chips
│       ├── ScreenshotUploader.tsx          ⭐ PNG/JPG ≤5MB picker
│       ├── TicketStub.tsx                  ⭐ Now embeds <QrBlock> per seat
│       ├── QrBlock.tsx                     ⭐ Client-side QR PNG via `qrcode` package
│       ├── ResendEmailButton.tsx           ⭐ Real POST /api/orders/:code/resend-email
│       ├── OrderCard.tsx                   ⭐ Uses order.code (was order.id)
│       ├── OAuthButton.tsx
│       ├── EmailAuthForm.tsx
│       └── CancelClient.tsx
├── lib/
│   ├── copy.ts                     +checkout.instructions/upload/verifying/rejected/softCap
│   ├── movie.ts
│   ├── seats.ts                    PRICE_PER_SEAT_LPS, formatters
│   ├── orders.ts                   Order DTO carries `code` + `tickets:[{seat,qrPayload}]`
│   ├── holds.ts
│   ├── checkoutVerify.ts           ⭐ Browser client: submitScreenshot(file) → VerifyResult
│   ├── auth.ts                     SessionUser now has `role`; +requireRole(allowed,next)
│   ├── api.ts                      BACKEND_URL
│   ├── format.ts
│   └── useCountdown.ts
└── public/
    └── cover.jpg
```

## Surface notes

### Landing (`/`)
Hero uses the real album cover JPG with a radial CSS mask that hides the starfield/Earth/lens flare so only the CD blends on Hall Black. Programmer's note + four-row tracklist + fórmula + venue + map link unchanged.

### Seat picker (`/seats`)
Real **SALA 4** layout (121 seats / 9 rows / 19-col master grid). Four seat states with pattern-plus-color. Borders are off-white (`border-bulb/40` idle, `border-bulb` hover, dimmer for held/taken). Keyboard nav. Max-8 enforcement. 10-min client-side hold timer.

### Checkout (`/checkout`)
Reads `?seats=` + `?expires=`. SSR fetches `POST /api/orders/pending` to allocate (or reuse) the 6-char `orderCode`. Renders eyebrow + marquee + dateLine + venue + `<SeatsTable>` + `<CheckoutClient>` with three phases:
- **idle** — `<PaymentInstructionsCard>` (account / amount / REFERENCIA with copy-to-clipboard) + `<ScreenshotUploader>` (`VERIFICAR PAGO →` gold CTA).
- **verifying** — pulse dot + "Verificando comprobante…". 30s client soft cap flips to softCap.
- **softCap** — "Estamos revisando tu pago — te avisaremos por correo cuando esté listo."

Approve → hard-nav `/success?order=<code>`. Reject → inline alert + retry. `attempts-exhausted` / `holds-expired` → `/seats?flash=…`. Hold timer ticks alongside via the existing `useCountdown`.

`NEXT_PUBLIC_BANK_ACCOUNT_REF` (set in `frontend/.env.local`) feeds the instructions card.

### Success (`/success`)
Reads `?order=<code>` only. Looks up the matching paid order from `getMyOrders()` (cookie-forwarded `GET /api/my-tickets`). Renders one `<TicketStub>` per `tickets[i]` with `qrPayload` → `<QrBlock>` (256px PNG, ECC=M, client-side rendered). Toolbar has `<ResendEmailButton orderCode={order.code}>` (real endpoint) + `VER MIS BOLETOS →`.

### My tickets (`/my-tickets`)
Stack of `<OrderCard>` rows. Each card uses `order.code` for display, the reopen-href to `/success?order=<code>`, and the `ResendEmailButton`. Past orders dim + hide resend.

### Sign in (`/signin`)
Google OAuth (only with env keys) + `<EmailAuthForm>` with sign-in/sign-up toggle. `?next=` sanitized via allow-list.

### Cancel (`/cancel`)
Active vs expired variants, swaps without re-fetching. Provider-neutral copy.

### Admin scan (`/admin/scan`) ⭐ new
`requireRole(["doorStaff","admin"])`. Full-screen camera viewfinder (`getUserMedia` + `jsqr` 250ms tick + 2s cooldown after a successful read). On scan, POSTs `/api/admin/scan` and shows a 1.5s overlay (`bg-emerald-700` green, `bg-amber-600` yellow for already-used, `bg-red-700` red for invalid) before fading via `animate-scan-fadeout`. Bottom strip shows last 5 scans with colored dots.

### Admin door (`/admin/door`) ⭐ new
`requireRole(["admin"])`. Header counters (VENDIDAS / ESCANEADAS / capacity). Live search by name or code. Per-order row with per-seat colored dot + `MARCAR ENTRADA ✓` button (`POST /api/admin/manual-checkin`, optimistic UI). Fallback for when a phone is dead.

## Email templates

Rendered via `@react-email/components`, sent via Resend.

- **OrderConfirmationEmail** — to customer. Subject: `Tu reservación CUATRO · <code>`. Per-seat sections with `<img src="cid:qr-A7">` referencing inline PNG attachments (rendered by `qrRender.renderQrPng`).
- **PaymentArchiveEmail** — to `PAYMENT_ARCHIVE_EMAIL`. Subject: `[CUATRO] <code> · L<amount> · <guestName>`. Includes verdict metadata. Screenshot attached **only when verdict is rejected** (debug aid).
- **OrderRejectionEmail** — to customer, only on the async-pending reject path. Includes the reason in Spanish and a retry URL to `/checkout?retry=<code>`.

## Door-side QR

`signQrPayload(orderCode, seatLabel)` → `cuatro:1:<code>:<seat>:<base64url-hmac>` (HMAC-SHA256 over `cuatro:1:<code>:<seat>` with `QR_SIGNING_SECRET`). `verifyQrPayload(s)` constant-time compares with `crypto.timingSafeEqual`. PNG render with `qrcode` package (512px, ECC=M, no truncation of the signature).

## How to run

First-time setup:

```bash
# Postgres
cd /Users/alejandro/Desktop/Cuatro
docker compose up -d

# Backend
cd backend
npm install
cp .env.example .env
# Edit backend/.env and set:
#   QR_SIGNING_SECRET=<openssl rand -hex 32>
#   BANK_ACCOUNT_REF=Banco Atlántida · Cuenta 0000000000 · Cuatro Films
#   PAYMENT_ARCHIVE_EMAIL=pagos@cuatro.example
#   ANTHROPIC_API_KEY=sk-ant-...
#   RESEND_API_KEY=re_...
#   (optional) GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npx prisma migrate deploy
npm run db:seed                    # idempotent: 1 movie + 121 seats

# Frontend
cd ../frontend
npm install
# Edit frontend/.env.local and set:
#   API_URL=http://localhost:4000
#   NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
#   NEXT_PUBLIC_BANK_ACCOUNT_REF=Banco Atlántida · Cuenta 0000000000 · Cuatro Films

# Test DB (one-time)
docker compose exec -T postgres psql -U cuatro -d postgres \
  -c "CREATE DATABASE cuatro_test OWNER cuatro;"
```

Daily run (two terminals):

```bash
cd backend && npm run dev          # http://localhost:4000
cd frontend && npm run dev         # http://localhost:3000 (or :3001 if 3000 busy)
```

Useful one-offs:

```bash
cd backend && npm test             # 25 tests, ~4s
cd backend && npm run typecheck
cd frontend && npm run typecheck
cd backend && npx prisma studio
cd backend && npx prisma migrate reset --force   # wipe + reseed dev DB
```

End-to-end click-through:

```
/                              → landing
/signin?next=/seats            → email/password or Google
/seats                         → pick up to 8 seats (10-min hold)
/checkout?seats=A1,A2&expires= → see account/amount/REFERENCIA, upload screenshot
                                  → POST /api/checkout/verify → Claude verifies
                                  → /success?order=<code>
/success?order=<code>          → ticket stubs with embedded QR
/my-tickets                    → real order history (only paid orders)
/admin/scan                    → door staff: camera viewfinder, scan QRs
/admin/door                    → admin: manifest, search, manual check-in
```

To exercise local states without a real LLM call:

- **Swap to FakeVerifier in dev** — edit `backend/src/index.ts` and import `FakeVerifier` instead of `ClaudeVerifier`. Pass `new FakeVerifier({ ok: true, txnId: "TXN-DEV", senderName: null })` to drive approvals deterministically. Re-build/restart.
- **Promote a user to doorStaff/admin** — `npx prisma studio` → User row → set `role = doorStaff` (for scanner) or `admin` (for door + scanner).
- **Empty `/my-tickets`** — the default for new accounts. Insert a manual order via Prisma Studio to test the populated layout.
- **Cancel variants** — visit `/cancel?seats=C7,C8&expires=<now+30000>` and wait.

To enable Google OAuth locally:

1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials (Web app).
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
3. Drop `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into `backend/.env` and restart.

## What's left

The payment-pivot plan is **fully implemented** (19/19 tasks landed). No further coding work is required to make the flow functional; what remains is operational.

### Pre-launch operational checklist

1. **Provision real API keys.** `ANTHROPIC_API_KEY` (Anthropic Console), `RESEND_API_KEY` (Resend dashboard, verified sender domain). Drop into `backend/.env` (gitignored).
2. **Final bank account details.** Set `BANK_ACCOUNT_REF` in `backend/.env` AND `NEXT_PUBLIC_BANK_ACCOUNT_REF` in `frontend/.env.local` to the actual production values. They are mirrored intentionally — the LLM checks against the backend value while the frontend renders the customer-facing copy.
3. **Real end-to-end smoke test.** Sign in → pick seats → upload a real Tigo Money / bank screenshot → check email delivery → scan the QR from another phone on `/admin/scan`. Document any verdict false-positives/negatives and tune `SYSTEM_PROMPT` in `services/paymentVerifier.ts`.
4. **Promote staff accounts.** Create door staff users via `/signin`, then promote via Prisma Studio. There is no admin UI for role management yet — explicitly out of scope for v1.
5. **CORS in prod.** `backend/src/index.ts` allows `:3000` + `:3001` in dev; tighten to a single explicit origin in production.

### Operational follow-ups (optional)

- **`/admin/staff` surface** for role management — currently manual via Prisma Studio. Defer unless adding more staff than is manageable by hand.
- **`POST /api/admin/orders/:code/mark-paid`** — manual override for edge-case cash-at-door payments. Out of v1 scope; current flow expects every paid order to go through verification.
- **Header user menu** — sign-in indicator + logout button. `POST /api/auth/logout` is wired; just no surface yet.
- **`OAuthButton` glyph** — currently a stylized monochrome G. Replace with the official multi-color Google G if brand approval comes through.
- **`PosterPlaceholder.tsx`** — unused, can delete.
- **DESIGN.md is still seeded** (`<!-- SEED -->`). Re-run `/impeccable document` in scan mode once the visual system is fully settled.

## Test accounts in dev DB

- `alejandro21232@gmail.com` (email/password) — phase 3 verification.
- `wire@test.com` (email/password) — frontend wire-up verification.

Both `customer` role. Promote one via `npx prisma studio` (User row → role) to test `/admin/scan` or `/admin/door`. Reset with `prisma migrate reset --force` for a clean slate.

## Files at the project root

| File | Role |
|---|---|
| `PRODUCT.md` | Strategic context, register, principles, anti-references |
| `DESIGN.md` | Seed visual system, North Star, named rules, OKLCH tokens |
| `PLAN.md` | Original 10-phase implementation plan (backend roadmap) |
| `HANDOFF.md` | This file |
| `docs/superpowers/specs/2026-06-02-payment-pivot-design.md` | Spec for the bank-transfer + AI flow |
| `docs/superpowers/plans/2026-06-02-payment-pivot.md` | 19-task implementation plan (fully landed) |
| `docker-compose.yml` | Postgres 16 on host port 5433 (volume `cuatro-pgdata`) |
| `frontend/` | Next.js 15 app (landing + seats + checkout + success + my-tickets + signin + cancel + admin/{scan,door}) |
| `backend/` | Express 5 + Prisma + Passport + Claude verifier + QR + Resend (25 vitest tests passing) |

## Useful pointers

- Impeccable plugin SKILL: `~/.claude/plugins/marketplaces/local-desktop-app-uploads/impeccable/.claude/skills/impeccable/SKILL.md`
- Anthropic SDK docs: https://docs.anthropic.com/en/api/getting-started
- Resend docs: https://resend.com/docs
- `qrcode` (Node, used by backend): https://github.com/soldair/node-qrcode
- `jsqr` (browser, used by `/admin/scan`): https://github.com/cozmo/jsQR
