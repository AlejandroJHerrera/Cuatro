# Session Handoff — Cuatro Ticketing Site

Drop this file (plus `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in the same directory) into a new Claude Code session and paste this line as your first message:

> Read `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in this directory and continue from where the previous session left off.

---

## What this project is

A production web app to sell tickets to a **single movie function**: a documentary screening for the album **"CUATRO"** by **Jose Javier Diaz** (4 tracks named after seasons + cardinal directions).

- **Venue (placeholder, swap when finalized):** Cinepolis Altara, San Pedro Sula, Honduras (SALA 4 — irregular 121-seat house).
- **Showtime:** **24 June 2026, 7:00 PM** (was 27 Jun 6 PM — updated 2026-06-03).
- **Proceeds:** A beneficio de la Casa de Jose — surfaced on the landing programmer's note.
- **Audience:** Spanish-speaking music + film fans, mostly arriving on phones from a shared link.
- **Flow:** sign up (or sign in) with email + password → pick seats on an interactive map → confirm reservation → **bank-transfer screenshot upload, AI-verified by Claude Sonnet 4.6** → emailed confirmation with per-seat signed QR codes → door staff scan QRs at the door (with manual check-in fallback).

Project root: `/Users/alejandro/Desktop/Cuatro/`

## Stack (locked in)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first via `@theme`) + a handful of `@utility` directives |
| Fonts | Fraunces (display serif), DM Sans (body), JetBrains Mono (operational), all via `next/font/google` |
| Backend | Express 5 + TypeScript on `:4000` |
| Database | PostgreSQL 16 via Prisma 5.22 — `docker compose up -d` on host port **5433** |
| Auth | Email/password via Passport.js + Postgres-backed session cookie. Google OAuth strategy is still wired backend-side (conditional on `GOOGLE_CLIENT_ID/SECRET`) but **the UI button on `/signin` was removed 2026-06-03** — sign-up is now the default visible form. |
| Payments | **Bank transfer + Claude Sonnet 4.6 verification (extract-then-judge).** Customer uploads a receipt screenshot to `POST /api/checkout/verify`; `ClaudeVerifier` calls the Anthropic SDK to **extract** fields (`extract_receipt` tool → `ReceiptFields`), then a pure, unit-tested `judgeReceipt()` renders the verdict: account-number gate (`BANK_ACCOUNT_NUMBER`), exact amount, **same-day** (Honduras) freshness, non-empty bank reference, and **the order code present in the transfer's Descripción**. On approve it converts holds → Tickets and emits HMAC-SHA256-signed QR payloads. Screenshots are never persisted (multer `memoryStorage`). |
| Email | Resend + `@react-email/components`. Three templates: customer confirmation (with inline QR PNGs), internal payment archive, customer rejection. |
| Door entry | Per-seat HMAC-signed QR codes, scanned by door staff via `/admin/scan` (jsqr camera viewfinder + floating verdict toast with smooth pop-in/out). Admins fall back to manual check-in on `/admin/door`. |
| Testing | Vitest + supertest backend harness. 40 tests across 8 files. Truncating Postgres `cuatro_test` DB on `:5433`. |

Max seats per order: **121** (raised from 8 on 2026-06-03 — effectively the venue capacity, no per-order cap). Price: **L 1,000** per seat (raised from L 12 on 2026-06-03). Constants in [`frontend/lib/seats.ts`](frontend/lib/seats.ts): `PRICE_PER_SEAT_LPS`, `MAX_SEATS_PER_ORDER`, `formatTotalLPS`, `formatPriceLPS`. Backend mirrors via `MAX_SEATS_PER_HOLD` in [`services/holds.ts`](backend/src/services/holds.ts) and `Movie.priceLps` (seeded value).

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
    │   ├── admin.test.ts           4 tests (valid / already-used / tampered / wrong-role)
    │   └── ticketQr.ts             GET /api/tickets/:code/:seat/qr.png — public PNG
    │                                of the signed QR, re-rendered from stored qrPayload.
    │                                Used by the customer email's <img> tags so QRs render
    │                                inline in Gmail/Outlook/etc.
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
| GET | `/api/tickets/:code/:seat/qr.png` | Public PNG of the per-seat QR (re-rendered from `Ticket.qrPayload`). 404 if order isn't paid. 24h cached. Referenced from email `<img>` so QRs render inline in any client. |

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
│   ├── signin/page.tsx             Email/password only (Google button removed 2026-06-03)
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
│       ├── PhotoCarousel.tsx               ⭐ Landing carousel (8 WhatsApp photos, 4s autoplay, 1s crossfade)
│       ├── OAuthButton.tsx                 (orphaned — no longer rendered on /signin)
│       ├── EmailAuthForm.tsx               Default mode = signup (flipped 2026-06-03)
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
    ├── cover.jpg                           Hero album-cover JPG (CD-masked)
    └── WhatsApp Image 2026-06-02 at 9.*.jpeg   8 carousel photos consumed by <PhotoCarousel>
```

## Surface notes

### Landing (`/`)
Hero uses the real album cover JPG with a radial CSS mask that hides the starfield/Earth/lens flare so only the CD blends on Hall Black. Under the **CUATRO** wordmark sits the italic display subtitle **"LA BANDA SONORA DE LA VIDA"** (added 2026-06-03), then the dateLine. The hero CTA is mobile-unchanged but on `sm+` is widened (`sm:min-w-[28ch] sm:px-16`) and horizontally centered (`sm:items-center` on the wrapping flex column). Programmer's note now uses bigger body type (`text-lg sm:text-xl`), includes the italic line **"A beneficio de la Casa de Jose"**, and embeds the auto-cycling `<PhotoCarousel>` (8 WhatsApp photos, 4s interval, 1s crossfade, gold pill indicator). Four-row tracklist + fórmula + venue + map link unchanged.

### Seat picker (`/seats`)
Real **SALA 4** layout (121 seats / 9 rows / 19-col master grid). Four seat states with pattern-plus-color. Borders are off-white (`border-bulb/40` idle, `border-bulb` hover, dimmer for held/taken). Keyboard nav. **No per-order seat cap** — `MAX_SEATS_PER_ORDER = 121` (venue capacity). The `maxNotice` plumbing in [`SeatPickerApp.tsx`](frontend/app/components/SeatPickerApp.tsx) + [`CartPanel.tsx`](frontend/app/components/CartPanel.tsx) is still wired but never fires. 10-min client-side hold timer.

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
**Email/password only** (Google OAuth button removed from the UI 2026-06-03 — backend route still exists, just unlinked). `<EmailAuthForm>` opens in **signup** mode by default; the secondary toggle button drops to sign-in. `?next=` sanitized via allow-list.

### Cancel (`/cancel`)
Active vs expired variants, swaps without re-fetching. Provider-neutral copy.

### Admin scan (`/admin/scan`) ⭐ new
`requireRole(["doorStaff","admin"])`. Full-screen camera viewfinder (`getUserMedia` + `jsqr` 250ms tick + 2s cooldown after a successful read). On scan, POSTs `/api/admin/scan` and shows a **floating verdict toast** centered near the middle of the viewfinder: emerald **ADELANTE · seat · name** with checkmark icon, amber **YA ESCANEADO** with warning icon, or red **INVÁLIDO** with X icon. Toast uses `animate-scan-pop` (slide-up + scale 0.94→1, holds, then slide-down + fade — 2.4s, `cubic-bezier(0.22, 1, 0.36, 1)`). A scan-id counter keys the toast so identical back-to-back verdicts re-animate cleanly. Bottom strip shows last 5 scans with colored dots.

**Camera requires HTTPS** (`getUserMedia` is a secure-context API). Works fine on `localhost`, fails on plain `http://192.168.x.x`. For LAN/phone testing, tunnel the frontend via ngrok — see "Phone testing via ngrok" below.

### Admin door (`/admin/door`) ⭐ new
`requireRole(["admin"])`. Header counters (VENDIDAS / ESCANEADAS / capacity). Live search by name or code. Per-order row with per-seat colored dot + `MARCAR ENTRADA ✓` button (`POST /api/admin/manual-checkin`, optimistic UI). Fallback for when a phone is dead.

## Email templates

Rendered via `@react-email/components`, sent via Resend.

- **OrderConfirmationEmail** — to customer. Subject: `Tu reservación CUATRO · <code>`. Per-seat sections with `<img src="${BACKEND_URL}/api/tickets/<code>/<seat>/qr.png">` (the public route in [`routes/ticketQr.ts`](backend/src/routes/ticketQr.ts)). Also attaches each QR as a downloadable `qr-<seat>.png` so customers always have savable files even when the inline image fails to load (e.g. mail client blocks remote images). The original CID/inline-attachment approach was dropped — Gmail webmail rendered it as broken icons.
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
#   BANK_ACCOUNT_NUMBER=0000000000   # digits only — the verifier's account gate
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

### Phone testing via ngrok (camera + cross-device flows)

`/admin/scan` and any test where a customer flow needs to happen on a real phone require **HTTPS** (camera) and a host the phone can resolve (not `localhost`). Setup:

```bash
brew install ngrok
ngrok config add-authtoken <token>          # one time
ngrok http 3000                              # tunnels only the frontend
```

The frontend proxies all `/api/*` requests to the backend via a Next.js rewrite in [`frontend/next.config.ts`](frontend/next.config.ts). That means **a single ngrok tunnel covers both surfaces** — the phone hits `https://<your-tunnel>.ngrok-free.dev`, Next sees `/api/...`, rewrites to `http://localhost:4000/api/...` on the laptop. No CORS, no mixed-content, no second tunnel.

Set these env vars to the ngrok URL so emails + redirects use the public host:

- `backend/.env` → `BACKEND_URL=https://<tunnel>.ngrok-free.dev` (QR image URLs in emails), `FRONTEND_URL=https://<tunnel>.ngrok-free.dev` (rejection email retry links).
- `frontend/.env.local` → leave `NEXT_PUBLIC_BACKEND_URL=` blank (browser uses same-origin → rewrite). Keep `API_URL=http://localhost:4000` for Next server components.

Restart both dev servers, point the phone at the ngrok URL, click through the warning page, sign in. iOS Safari will prompt for camera permission on `/admin/scan` — allow.

**Free-tier caveat:** ngrok gives one static subdomain. Every restart can change the URL — update the two env files accordingly. The CORS rule in [`backend/src/index.ts`](backend/src/index.ts) already permits any `192.168.x.x` / `10.x.x.x` / `172.16-31.x.x` origin in dev so direct LAN access still works when you don't tunnel.

### Same-origin pattern (browser ↔ backend)

The frontend has two BACKEND_URL conventions that are easy to confuse:

- **Server components** (e.g. [`app/admin/door/page.tsx`](frontend/app/admin/door/page.tsx), [`app/checkout/page.tsx`](frontend/app/checkout/page.tsx), [`lib/movie.ts`](frontend/lib/movie.ts)) call the backend **directly** using `process.env.API_URL` (`http://localhost:4000` in dev, the real backend in prod). Node `fetch` needs an absolute URL.
- **Client components** (e.g. [`ScanClient.tsx`](frontend/app/admin/scan/ScanClient.tsx), [`CheckoutClient.tsx`](frontend/app/components/CheckoutClient.tsx), [`EmailAuthForm.tsx`](frontend/app/components/EmailAuthForm.tsx)) import `BACKEND_URL` from [`lib/api.ts`](frontend/lib/api.ts) which defaults to **empty string** — same-origin. The Next rewrite proxies `/api/*` to the backend.

If you ever see *"Failed to parse URL from /api/..."*, you're using the empty-string `BACKEND_URL` in a server component. Switch to `process.env.API_URL` and it's fixed.

To enable Google OAuth locally:

1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials (Web app).
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
3. Drop `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into `backend/.env` and restart.

## Current state (as of 2026-06-03 evening)

The payment-pivot plan is **fully implemented** (19/19 tasks landed). The 2026-06-02 session added:

- **Hosted-URL QR delivery** ([`routes/ticketQr.ts`](backend/src/routes/ticketQr.ts) + email template swap) so QRs render inline in Gmail. PNG attachments are still sent alongside as a fallback.
- **Next.js rewrite proxy** ([`frontend/next.config.ts`](frontend/next.config.ts)) so the browser only ever talks to the same origin as the frontend. Enables single-tunnel ngrok for phone testing and removes mixed-content / CORS issues.
- **Smooth verdict toast** in `/admin/scan` — replaced the full-screen color slam with a centered card that pops in (`animate-scan-pop` keyframe) with icon + status + seat·name.
- **Dev LAN CORS regex** in [`backend/src/index.ts`](backend/src/index.ts) so a phone on the LAN can reach the dev backend directly when not tunneling.

### 2026-06-03 session — UI + business changes

- **Showtime moved** to 24 Jun 2026 7:00 PM. Placeholder ISO updated in [`frontend/lib/movie.ts`](frontend/lib/movie.ts:24) and seed `startsAt` in [`backend/prisma/seed.ts`](backend/prisma/seed.ts:38). **Re-run `prisma migrate reset --force && npm run db:seed` (or edit `Movie.startsAt` in Prisma Studio) to push the change into the dev DB** — frontend constants alone don't flip the backend's `Movie` row.
- **Price → L 1,000 per seat.** [`frontend/lib/seats.ts`](frontend/lib/seats.ts:64), [`backend/prisma/seed.ts`](backend/prisma/seed.ts:44), [`backend/src/test/factories.ts`](backend/src/test/factories.ts:28) all updated. Same re-seed caveat applies for the backend Movie row. Format note: `formatTotalLPS` still emits `$1000.00 LPS` — consider tightening to `L 1,000` (no decimals, Lempira sigil) as a polish pass.
- **Per-order seat cap removed** — `MAX_SEATS_PER_ORDER` and `MAX_SEATS_PER_HOLD` raised 8 → 121 (venue capacity, effectively unlimited).
- **Hero subtitle** "LA BANDA SONORA DE LA VIDA" added under CUATRO ([`Hero.tsx`](frontend/app/components/Hero.tsx) + [`copy.ts`](frontend/lib/copy.ts) `hero.subtitle`).
- **Hero CTA** mobile unchanged; desktop (`sm+`) widened (`sm:min-w-[28ch] sm:px-16`) and centered (`sm:items-center` on the wrapping flex column).
- **Programmer's note** bumped from `text-base sm:text-lg` → `text-lg sm:text-xl`. Added italic display line **"A beneficio de la Casa de Jose"** ([`copy.ts`](frontend/lib/copy.ts) `note.benefit`).
- **New `<PhotoCarousel>` component** ([`frontend/app/components/PhotoCarousel.tsx`](frontend/app/components/PhotoCarousel.tsx)) embedded in the programmer's note. 8 WhatsApp JPEGs from `public/`, hardcoded list, `setInterval(4000)`, opacity-based crossfade with `transition-opacity duration-1000`, gold pill dot indicators. `cover.jpg` deliberately excluded.
- **Google sign-in button removed** from [`signin/page.tsx`](frontend/app/signin/page.tsx) — `<OAuthButton>` + divider gone, divider helper deleted. `OAuthButton.tsx` is now dead code (kept on disk in case you reintroduce OAuth).
- **Default auth mode flipped to signup** in [`EmailAuthForm.tsx`](frontend/app/components/EmailAuthForm.tsx:24). The existing toggle button drops to sign-in as the secondary path.
- **Production domain registered: `discocuatro.com`** on Cloudflare. Resend domain verified (SPF + DKIM), DMARC TXT set at `p=none`. `FROM` swapped in [`backend/src/services/email.ts:18`](backend/src/services/email.ts:18) → `Cuatro <no-reply@discocuatro.com>`.
- **Real bank account wired**: `BAC · Cuenta 100355841 · José Javier Díaz Alvarado` set identically in `backend/.env` (`BANK_ACCOUNT_REF`) and `frontend/.env.local` (`NEXT_PUBLIC_BANK_ACCOUNT_REF`). Claude verifier will cross-check the screenshot against this string.

### 2026-06-04 session — verifier rework + real-receipt validation

Reworked the payment verifier to **extract-then-judge** and validated it end-to-end against real BAC receipts. Spec/plan in [`docs/superpowers/specs/2026-06-03-payment-verifier-extraction-design.md`](docs/superpowers/specs/2026-06-03-payment-verifier-extraction-design.md) + [`docs/superpowers/plans/2026-06-03-payment-verifier-extraction.md`](docs/superpowers/plans/2026-06-03-payment-verifier-extraction.md).

- **Extract-then-judge.** `ClaudeVerifier` now only **extracts** fields via the `extract_receipt` tool → `ReceiptFields`; a pure, unit-tested `judgeReceipt(fields, expected, now)` renders the verdict. The safety-critical comparisons are deterministic TypeScript, not the model. **FakeVerifier is off** — [`index.ts`](backend/src/index.ts) uses `new ClaudeVerifier()` with a real `ANTHROPIC_API_KEY`.
- **New env var `BANK_ACCOUNT_NUMBER=100355841`** (digits-only, Zod-validated) — the account-number gate. `BANK_ACCOUNT_REF` stays as the human-readable display string. Added to `.env`, `.env.example`, `.env.test`.
- **Verdict rules:** account number must equal `BANK_ACCOUNT_NUMBER`; amount must equal the order total (to the cent); **same-day** freshness (the receipt's Honduras calendar date must be today); non-empty bank reference (stored as `txnId` for dedup); and **the order code must appear in the transfer's Descripción** (normalized contains — case/space/punctuation-insensitive). New rejection reason `reference-mismatch`.
- **Year anchor.** Real BAC "Resultado de transferencia" shows a date with **no year** (e.g. "03 junio"); the model was guessing 2025. The prompt now injects today's Honduras date (`honduranDateString`) so omitted years resolve correctly.
- **⚠️ NEW customer-facing requirement:** customers **must write the order code (REFERENCIA) in the transfer's Descripción/Detalle**, and pay **the same day**. Checkout now surfaces this — [`PaymentInstructionsCard.tsx`](frontend/app/components/PaymentInstructionsCard.tsx) shows a prominent gold callout at the top, and the copy buttons were rewritten to work on mobile + desktop (Clipboard API + `execCommand` fallback + `COPIADO ✓` feedback).
- **Validation.** Debugged two failing real BAC screenshots (root causes: wrong-year guess → false stale; no order code in Descripción). Then validated the full **approve → ticket → QR → email → /admin/scan → /admin/door** path through the **real Claude verifier** using a mock BAC receipt (HTML→PNG via macOS `qlmanage`) carrying today's date + the order code. 40 backend tests pass.
- **⚠️ Shell gotcha:** this machine's shell exports an **empty `ANTHROPIC_API_KEY`** that shadows `.env` (dotenv won't override it). Start the backend with `unset ANTHROPIC_API_KEY && npm run dev` or env validation fails as if the key were missing.
- **Dev DB has leftover test orders** — `63C4WK` (seat A5, josecachin20), `NBMPBZ` (seat A6, mjdiazchin) are *paid* and holding seats; `YVUT5U`/`EMCD5U` are pending. Clear these (e.g. `prisma migrate reset --force && npm run db:seed`, then re-promote admin/doorStaff) before launch so the seat map is clean.

### 2026-06-04 session (deployment) — PRODUCTION LAUNCH + post-launch changes

**The app is LIVE in production.**

- **Frontend:** Vercel → **https://discocuatro.com** (custom domain on Cloudflare, HTTPS, valid cert). Root dir `frontend`. Env: `API_URL=https://cuatro-production.up.railway.app`, `NEXT_PUBLIC_BANK_ACCOUNT_REF=...`, `NEXT_PUBLIC_BACKEND_URL` left **blank** (same-origin rewrite preserved). **Vercel Deployment Protection (Vercel Authentication) was disabled** so the public can reach the site (preview/git-branch URLs are still auth-walled).
- **Backend:** Railway → **https://cuatro-production.up.railway.app**. Root dir `backend`. App binds Railway-injected `PORT=8080`; the public domain's **target port must be 8080** (a mismatched target port → Railway "train has not arrived" 404 even though the app is healthy and Active). Added **`postinstall: prisma generate`** to `backend/package.json` so Railway's clean install generates the Prisma client before the `tsc` build.
- **Database:** Railway managed Postgres. `DATABASE_URL` is set to the **public proxy URL** (`...proxy.rlwy.net:PORT`) — the internal `${{Postgres.DATABASE_URL}}` reference did **not** connect on first setup (`/health` returned `ok:false`); the public proxy works. Migrations (`prisma migrate deploy`) + seed run **once from the laptop** against the public URL. The `session` table auto-creates on first request. Internal private networking is a deferred optimization.
- **Railway env vars:** `NODE_ENV=production`, `SESSION_SECRET` (fresh), `QR_SIGNING_SECRET` (**kept the dev value** so migrated QRs stay valid), `ANTHROPIC_API_KEY` + `RESEND_API_KEY` (**rotated** — old ones were leaked), `BANK_ACCOUNT_REF`/`BANK_ACCOUNT_NUMBER`, `PAYMENT_ARCHIVE_EMAIL`, `FRONTEND_URL=https://discocuatro.com`, `BACKEND_URL=https://cuatro-production.up.railway.app`. **`REPLY_TO_EMAIL` intentionally NOT set** (owner opted out).
- **Next.js security bump:** `15.1.6 → 15.5.19` (CVE-2025-29927) + `postcss` bump — Vercel **blocks** deploys on the vulnerable Next version.

**Real orders migrated to prod.** ⚠️ The two paid orders from the local dev DB — `63C4WK` (Jose Carlos Chinchilla, seat **A5**) and `NBMPBZ` (Maria Diaz, seat **A6**) — are **REAL customer purchases, not test data** (the earlier handoff wrongly called them leftover test orders). Migrated to prod (users + orders + tickets + receipts), remapping seat IDs by **label** since seed cuids differ per DB. QR payloads stay valid because prod uses the same `QR_SIGNING_SECRET`. Verified A5/A6 read `taken` on prod and all QR signatures validate. The customers can log in on `discocuatro.com` (password hashes migrated) and use the resend-email button to get a fresh email with correct prod QR links.

**Prod smoke test PASSED.** Full real-money flow through the **live Claude verifier**: order `V9FRW5` (seat **A7**), real BAC transfer with the order code in *Detalle*, **approved on attempt 0**, ticket + QR + receipt created, confirmation email delivered, QR signature validates. `V9FRW5`/A7 is a kept test order (owner's own transfer). `alejandro21232@gmail.com` promoted to `admin` in prod.

**Email deliverability fix** ([`email.ts`](backend/src/services/email.ts)): all three emails now render a **text/plain alternative** alongside the HTML (HTML-only is a spam signal). Added optional **`REPLY_TO_EMAIL`** env (unset → no Reply-To header). DNS auth is correctly configured (DKIM `resend._domainkey` signs `d=discocuatro.com` → DMARC passes via DKIM; SPF on `send.discocuatro.com`). Spam placement is **new-domain reputation, not broken auth** — being mitigated by asking affected customers to mark "Not spam."

**UI:** programmer-note benefit line restyled to a **gold centered banner** above the carousel; text changed to **"A beneficio de el comedor público la casa de José"** ([`copy.ts`](frontend/lib/copy.ts) `note.benefit`, [`ProgrammerNote.tsx`](frontend/app/components/ProgrammerNote.tsx)).

**Feature shipped — longer holds + live seat map** (merged to `main`, deployed). Spec/plan: [`docs/superpowers/specs/2026-06-04-longer-holds-live-seat-map-design.md`](docs/superpowers/specs/2026-06-04-longer-holds-live-seat-map-design.md) + [`docs/superpowers/plans/2026-06-04-longer-holds-live-seat-map.md`](docs/superpowers/plans/2026-06-04-longer-holds-live-seat-map.md).
- **Hold lifetime 10 → 20 min** — `HOLD_DURATION_MS` in [`backend/src/services/holds.ts`](backend/src/services/holds.ts) (authoritative) + [`frontend/lib/seats.ts`](frontend/lib/seats.ts) mirror + "20 minutos" copy. Shrinks the window where a hold expires mid bank-transfer.
- **Live seat map** — `/seats` polls `GET /api/seats` every **5s** while the tab is visible (pauses when hidden via `visibilitychange`, immediate refetch on return). Merges fresh statuses, preserves the user's own selection (own held seats flip back to `available`, mirroring the SSR path), and **drops a selected seat that becomes `taken`** with a notice. New: `fetchSeatsClient()` in [`lib/holds.ts`](frontend/lib/holds.ts), `copy.seats.cart.lostSeatNotice(labels: string[])`, polling + `reconcileSeats` in [`SeatPickerApp.tsx`](frontend/app/components/SeatPickerApp.tsx). **No schema/migration — purely behavioral.** DB load is negligible (~48 queries/s worst case for the entire 121-seat house; the read path's lazy expired-hold purge still runs per request).

**Known residual / deferred (not blockers):**
- **Paid-but-lost-seat race** still possible in the narrow window where a hold expires mid-transfer AND another buyer takes the seat → **manual refund** is the accepted fallback (spec options C/D/E — persist intended seats on the Order + graceful recovery — deferred).
- Backend↔Postgres over the **public proxy** (internal networking optimization deferred).
- **`REPLY_TO_EMAIL` unset** (owner's choice).
- **Tier 3 ops still TODO:** Railway nightly DB backups (now important — real orders exist), UptimeRobot on `/health`, Sentry DSNs, DMARC `p=none → quarantine`.

The v1 flow is live and a real purchase has completed end-to-end in production. What follows is the remaining punch list.

## Production roadmap

### Tier 1 — Blockers before any real customer can buy a ticket

1. ✅ **Rotate leaked credentials.** *(Done 2026-06-04.)* `ANTHROPIC_API_KEY` and `RESEND_API_KEY` rotated; the new keys are set on Railway (prod). Old keys should be deleted in their dashboards if not already.
2. ✅ **Verify a real sending domain on Resend.** *(Done 2026-06-03.)* `discocuatro.com` registered on Cloudflare; SPF + DKIM verified on Resend; DMARC TXT live at `p=none`. `FROM` is `Cuatro <no-reply@discocuatro.com>` in [`email.ts:18`](backend/src/services/email.ts:18). **Still TODO**: actual deliverability test (send the confirmation to a Gmail address that isn't the Resend account owner, check inbox + spam, optionally score via mail-tester.com).
3. ✅ **Real bank account details.** *(Done 2026-06-03.)* `BAC · Cuenta 100355841 · José Javier Díaz Alvarado` set identically in `backend/.env` (`BANK_ACCOUNT_REF`) and `frontend/.env.local` (`NEXT_PUBLIC_BANK_ACCOUNT_REF`).
4. ✅ **Switch off FakeVerifier.** *(Done 2026-06-04.)* [`index.ts`](backend/src/index.ts) uses `new ClaudeVerifier()`, reworked to extract-then-judge (see 2026-06-04 session). Real `ANTHROPIC_API_KEY` set in `backend/.env`. **Start the backend with `unset ANTHROPIC_API_KEY` first** — the shell exports an empty key that shadows `.env`.
5. ✅ **Apply the new date + price to the DB.** *(Done.)* `Movie.startsAt` = `2026-06-24T19:00:00-06:00` and `Movie.priceLps` = `1000` confirmed in the dev DB. (Re-seed the prod DB at deploy.)
6. ✅ **Promote at least one admin account.** *(Done.)* `alejandro21232@gmail.com` = `admin`, `alexistabora@hotmail.com` = `doorStaff` in the dev DB. Re-promote after any prod re-seed.
7. ✅ **Confirm venue + showtime are final.** *(Done.)* CINEPOLIS ALTARA · SAN PEDRO SULA, 24 Jun 2026 7:00 PM confirmed.
8. ✅ **Real end-to-end smoke test.** *(Done 2026-06-04, in PRODUCTION.)* Order `V9FRW5` (seat A7) — a **genuinely fresh real BAC transfer** with the order code in *Detalle* — was **approved on attempt 0** by the live Claude verifier on `cuatro-production.up.railway.app`, producing ticket + QR + receipt + delivered confirmation email, with a valid QR signature. (Tigo Money receipts still untested — only validate that path if you'll accept them.) Customer rules in effect: REFERENCIA in the transfer's Descripción + **same-day** payment.

### Tier 2 — Hosting + deployment

> ✅ **COMPLETED 2026-06-04** — fully deployed (Railway backend+Postgres, Vercel frontend, `discocuatro.com`, prod env vars set, rewrite proxy kept). See the "PRODUCTION LAUNCH" session above for the exact setup, gotchas, and the real-purchase smoke test. Items 7–11 below are retained for reference.

7. ✅ **Pick a backend host.** *(Railway.)* Backend at `cuatro-production.up.railway.app`, root dir `backend`, `postinstall: prisma generate`, binds `PORT=8080` (domain target port = 8080). Managed Postgres provisioned; `migrate deploy` + `db:seed` run once from the laptop against the **public** proxy URL.
8. ✅ **Pick a frontend host.** *(Vercel.)* Root dir `frontend`, custom domain `discocuatro.com`, Deployment Protection disabled for public access.
9. **Set production env vars** on both hosts:
   - Backend: `DATABASE_URL`, `SESSION_SECRET` (regenerate — `openssl rand -hex 32`), `QR_SIGNING_SECRET` (keep dev or rotate), `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `BANK_ACCOUNT_REF`, `BANK_ACCOUNT_NUMBER` (digits-only, the verifier's account gate), `PAYMENT_ARCHIVE_EMAIL`, `FRONTEND_URL=https://discocuatro.com`, `BACKEND_URL=https://api.discocuatro.com` (or your single-origin URL if keeping the rewrite), `NODE_ENV=production`.
   - Frontend: `API_URL=https://api.discocuatro.com` (server-side fetches). Leave `NEXT_PUBLIC_BACKEND_URL=` blank to keep the same-origin pattern via the rewrite, OR set it to the backend URL if you've decided to call directly.
10. **Decide: keep the Next rewrite proxy in production, or call the backend directly?**
    - **Keep rewrite** = single origin, no CORS in prod, slightly more latency. Recommended for v1.
    - **Direct calls** = need to tighten the dev-only LAN regex in [`backend/src/index.ts`](backend/src/index.ts) and configure prod CORS to the exact frontend origin. More surface to misconfigure.
11. ✅ **Sessions + cookies in production.** *(Done 2026-06-04, code.)* [`auth/session.ts`](backend/src/auth/session.ts) already sets `secure: NODE_ENV==='production'`, `sameSite: 'lax'`, `httpOnly: true`, 30-day `maxAge` — correct for the single-origin (Next rewrite) setup. Switch `sameSite` to `'none'` only if you split frontend/backend onto different registrable domains.

### Tier 3 — Hardening + observability

> **Code-side hardening landed 2026-06-04** (branch `production-hardening`). Deploy/ops reference: [`docs/DEPLOY.md`](docs/DEPLOY.md).

12. ✅ **Tighten CORS in prod.** *(Confirmed 2026-06-04.)* Prod `allowedOrigins` is exactly `[env.FRONTEND_URL]`; the localhost + LAN-regex additions are gated on `NODE_ENV==='development'`. Just set `FRONTEND_URL` to the exact prod origin.
13. ✅ **Error monitoring (Sentry).** *(Wired 2026-06-04, gated.)* `@sentry/node` (backend, [`instrument.ts`](backend/src/instrument.ts)) and `@sentry/nextjs` (frontend) are installed and **no-op until a DSN is set**. To enable: set `SENTRY_DSN` (backend) and `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (frontend) in prod, then confirm a test event arrives.
14. ✅ **Surface Resend errors.** *(Done 2026-06-04.)* All mailer calls in [`checkoutVerify.ts`](backend/src/routes/checkoutVerify.ts) go through a `safeSend` helper that logs `result.error`/throws and never fails a paid order. The `<ResendEmailButton>` remains the customer escape hatch.
15. ✅ **Rate limit `/api/checkout/verify`.** *(Done 2026-06-04.)* `express-rate-limit` — 10/10 min per authenticated user (IPv6-safe key, skipped in tests), 429 on exceed.
16. **DB backups.** Whatever host you pick, enable nightly automated backups. Railway/Render/Fly all offer this in one click. *(Ops — see `docs/DEPLOY.md` checklist.)*
17. **DMARC + reply-to.** `p=none` → `p=quarantine` after monitoring; set `reply_to` to a real inbox. *(Ops — see `docs/DEPLOY.md`.)*
18. **Header user menu.** Sign-in indicator + logout button. `POST /api/auth/logout` is wired; just no UI surface yet. Customers will ask.
19. **Health-check ping.** UptimeRobot (free) hitting `GET /health` every 5 min. *(Ops — see `docs/DEPLOY.md`.)*

### Tier 4 — Nice-to-have, post-launch

- **`/admin/staff` UI** for role management — currently manual via Prisma Studio.
- **`POST /api/admin/orders/:code/mark-paid`** — manual override for cash-at-door edge cases.
- **Tighten Lempira formatting** — `formatTotalLPS` / `formatPriceLPS` in [`frontend/lib/seats.ts`](frontend/lib/seats.ts) still emit `$1000.00 LPS`. At whole-number prices the dollar sign + `.00` reads oddly; `L 1,000` would be cleaner.
- **Pre-compress carousel JPEGs** — the 8 WhatsApp photos in `public/` are full-resolution phone shots. Next.js Image resizes on demand but pre-compressing keeps mobile LCP healthier on slow networks.
- **Delete dead code** — `OAuthButton.tsx`, `PosterPlaceholder.tsx`, plus the now-unused `copy.signin.dividerLabel` and `copy.signin.googleCta` strings (and consider also pruning `maxNotice` plumbing in `SeatPickerApp` / `CartPanel` since the cap was effectively removed).
- **Header user menu.** Sign-in indicator + logout button. `POST /api/auth/logout` is wired; just no UI surface yet.
- **Soft per-order cap?** With no limit and L 1,000/seat, a misclick could put 50+ seats in the cart. A UI-only soft cap (e.g. 20 with a confirm) might be worth reintroducing.
- **Re-run `/impeccable document`** to lock the design system (DESIGN.md is still `<!-- SEED -->`).

### Suggested order

- **Week 1:** Tier 1 + Tier 2 → app live at a real URL, end-to-end purchase works.
- **Week 2 (pre-launch):** Tier 3 → silent failures become loud, hostile users get blocked.
- **Post-launch:** Tier 4 as demand surfaces.

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
