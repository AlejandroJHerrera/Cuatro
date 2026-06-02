# Session Handoff — Cuatro Ticketing Site

Drop this file (plus `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in the same directory) into a new Claude Code session and paste this line as your first message:

> Read `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md`, and `PLAN.md` in this directory and continue from where the previous session left off.

---

## What this project is

A production web app to sell tickets to a **single movie function**: a documentary screening for the album **"CUATRO"** by **Jose Javier Diaz** (4 tracks named after seasons + cardinal directions).

- **Venue (placeholder, swap when finalized):** Cinepolis Altara, San Pedro Sula, Honduras (SALA 4 — irregular 121-seat house).
- **Showtime (placeholder):** 27 June 2026, 6:00 PM.
- **Audience:** Spanish-speaking music + film fans, mostly arriving on phones from a shared link.
- **Flow:** sign in (Google OAuth or email + password) → pick seats on an interactive map → confirm reservation → upload bank transfer screenshot → AI verification (Claude Sonnet 4.6) → emailed confirmation with QR codes → door staff scan at `/admin/scan`.

Project root: `/Users/alejandro/Desktop/Cuatro/`

## Stack (locked in)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first via `@theme`) + a handful of `@utility` directives |
| Fonts | Fraunces (display serif), DM Sans (body), JetBrains Mono (operational), all via `next/font/google` |
| Backend | Express 5 + TypeScript on `:4000` ✅ scaffolded (helmet, CORS w/ credentials, session, passport, error handler, graceful shutdown) |
| Database | PostgreSQL 16 via Prisma 5.22 ✅ — `docker compose up -d` on host port **5433** (host port chosen to avoid colliding with any local Postgres on 5432) |
| Auth | Google OAuth + email/password via Passport.js + Postgres-backed session cookie ✅ (Google strategy registered conditionally — `GOOGLE_CLIENT_ID`/`SECRET` required to activate the route; everything else works without them) |
| Payments | Bank transfer + Claude Sonnet 4.6 verification via Anthropic SDK. No persisted screenshots; QR codes signed with HMAC-SHA256 and rendered to email + on-page. |
| Email | Resend, no QR — name-list verification at the door *(not yet wired — phase 7)* |
| Concurrency | ✅ 10-minute seat hold via `POST /api/holds` (replace-semantics), enforced server-side via `@@unique` on `SeatHold.seatId`. |

Max seats per order: **8**. Price: **$12.00 LPS**. Constants in [`lib/seats.ts`](frontend/lib/seats.ts): `PRICE_PER_SEAT_LPS`, `formatTotalLPS`, `formatPriceLPS` (renamed from `*_USD` this session).

## Design system (impeccable workflow)

Followed the `impeccable` plugin workflow: `teach` → `document --seed` → `shape` → `craft`. Three context files at the project root drive everything downstream:

- **[PRODUCT.md](PRODUCT.md)** — strategic doc. Register = `product`. Anti-references include corporate event-commerce (Ticketmaster/StubHub), generic SaaS minimalism, AI-cosmic kitsch, neon party flyers, album-platform tropes. Touchstones: **MUBI** + **Metrograph**. Principles include "the seat map is the centerpiece", "one night, one room", "restraint over atmosphere", "Spanish-first never translated-feeling", "treat the purchase like an RSVP".
- **[DESIGN.md](DESIGN.md)** — seed visual system. North Star: **"The Late-Night Marquee"**. Color strategy: **Restrained** (tinted near-blacks + Marquee Gold ≤5%). Serif display + clean sans body + mono-as-operator. Flat-by-default depth. Named rules: `One Bulb`, `No-Black No-White`, `Pattern-Plus-Color`, `Marquee`, `Mono-As-Operator`, `Flat-By-Default`, `One Light Source`.
- **[PLAN.md](PLAN.md)** — original 10-phase implementation plan (still the canonical backend roadmap).

Concrete OKLCH values, fonts, motion tokens, and the hero blend utilities live in [`frontend/app/globals.css`](frontend/app/globals.css) under `@theme` + `@utility`.

## What's built (backend — phases 1–5 + 8)

```
backend/
├── docker-compose.yml              Postgres 16 on host :5433 (volume cuatro-pgdata)
├── package.json                    tsx watch dev script, prisma scripts, db:seed
│                                   + stripe + nanoid (added this session)
├── prisma/
│   ├── schema.prisma               Final schema (see below)
│   ├── seed.ts                     Idempotent — upserts 1 Movie + 121 Seats from ROW_LAYOUTS
│   └── migrations/
│       ├── 20260520061159_init/
│       ├── 20260520061602_movie_fields/
│       └── 20260521120000_order_code/   ⭐ adds Order.code (unique, 6-char human-readable)
└── src/
    ├── index.ts                    Express bootstrap (helmet, CORS, sessions, passport)
    ├── env.ts                      zod-validated env (SESSION_SECRET has a dev default)
    ├── db.ts                       Prisma client singleton (dev HMR-safe)
    ├── auth/
    │   ├── session.ts              express-session + connect-pg-simple (auto table)
    │   ├── passport.ts             Google strategy (conditional on env)
    │   └── routes.ts               /auth/signup, /signin, /logout, /me, /auth/google[/callback]
    │                               + exports requireAuth middleware
    ├── routes/
    │   ├── movie.ts                GET /api/movie
    │   ├── seats.ts                GET /api/seats
    │   ├── holds.ts                ⭐ POST/DELETE /api/holds, GET /api/holds/me
    │   ├── myTickets.ts            ⭐ GET /api/my-tickets (paid orders for caller)
    │   └── checkout.ts             ⭐ POST /api/checkout/verify (bank transfer + AI verification)
    ├── services/
    │   ├── movie.ts                Projects Movie row + computes status (selling|sold-out|passed)
    │   ├── seatStatus.ts           Joins Ticket + SeatHold, lazily purges expired holds
    │   ├── holds.ts                ⭐ replaceUserHolds / releaseUserHolds / getUserHolds
    │   └── checkout.ts             ⭐ verifyAndFulfill() — ClaudeVerifier + holds→tickets + QR
    └── types/express.d.ts          Augments Express.User with Prisma User
```

### Schema highlights (vs. PLAN.md)

- **`Ticket.qrToken`** — HMAC-SHA256 signed payload generated at fulfillment; used by `/admin/scan` to verify door entry.
- **`User.passwordHash` optional, `User.providerId` optional**, `AuthProvider` enum is `google | email`. Postgres treats multiple NULL `providerId` rows as distinct, so the `@@unique([provider, providerId])` constraint still works for email accounts.
- **`Movie` carries the full frontend contract**: `director`, `runtimeMin`, `language`, `year`, `venueName`, `venueAddress`, `priceLps`. Status (`selling`|`sold-out`|`passed`) is derived in `services/movie.ts`, not stored.
- **`Order.guestName`** — printed on stubs + door list. Snapshotted from `User.name` at order-creation time in `services/checkout.ts`.
- **`Order.code`** ⭐ — 6-char human-readable code (nanoid, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`). This is what's printed on stubs and read off `?order=` in URLs. The cuid `id` is still the FK.
- **`Seat.kind`** enum (`standard|accessible`) mirrors the frontend's `Seat.kind`.

### Endpoints live

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Pings the DB. |
| GET | `/api/movie` | Returns the `MovieDTO` shape the frontend expects (see `services/movie.ts`). |
| GET | `/api/seats` | Returns 121 `{id,row,num,col,kind,status}` rows; expired holds purged before responding. |
| POST | `/api/auth/signup` | `{name,email,password}` — bcrypt-12, 409 on duplicate email, 400 on weak password (zod). Sets `cuatro.sid`. |
| POST | `/api/auth/signin` | Same shape minus name. 401 on bad creds — error message is intentionally identical for missing-user vs. wrong-password. |
| POST | `/api/auth/logout` | Destroys session and clears cookie. |
| GET | `/api/me` | Returns `{user}` or 401. |
| GET | `/api/auth/google` | 503 until `GOOGLE_CLIENT_ID`/`SECRET` set. Stashes `?next` in session. |
| GET | `/api/auth/google/callback` | Redirects to `${FRONTEND_URL}${next}`. Links existing email accounts when the email matches. |
| POST | `/api/holds` ⭐ | `{seatIds:[…]}`. Replace-semantics: drops user's prior holds + atomically claims new set in one tx, fresh 10-min TTL. Returns `{seatIds, expiresAt}`. 409 with `conflictSeatIds` on race-loss (P2002), 404 with `missingSeatIds` for bad labels, 409 `sold` if any seat already has a Ticket. Behind `requireAuth`. |
| DELETE | `/api/holds` ⭐ | Releases all of caller's holds. |
| GET | `/api/holds/me` ⭐ | `{seatIds, expiresAt}` or `{holds:null}`. Used by `/seats` SSR to restore selection after reload. |
| GET | `/api/my-tickets` ⭐ | `{orders: OrderDTO[]}`. Only `status=paid` orders for caller, joined to Movie + Seats. `status` (`upcoming`/`past`) derived from `movie.startsAt`. Until phase 6 fires, this returns `[]` for everyone. |
| POST | `/api/checkout/verify` ⭐ | Multipart upload (screenshot). Calls ClaudeVerifier → on approval converts active holds → Tickets in one tx, signs QR payloads, fires confirmation email with inline QR PNGs. Returns `{orderCode, seats}`. 400 no-holds / 410 expired-holds / 402 verification-rejected. Behind `requireAuth`. |

### Frontend → backend wiring

- `frontend/.env.local` exposes `API_URL` (server) + `NEXT_PUBLIC_BACKEND_URL` (browser), both `http://localhost:4000`.
- [`lib/auth.ts`](frontend/lib/auth.ts) — `getSessionUser()` + ⭐ `getMyHolds()` forward cookies via `next/headers`; `requireUser(next)` redirects to `/signin?next=` when 401.
- [`lib/api.ts`](frontend/lib/api.ts) — exports `BACKEND_URL` for client components.
- [`lib/holds.ts`](frontend/lib/holds.ts) ⭐ — browser client for `POST/DELETE /api/holds` with typed error reasons (`conflict | sold | missing | auth | network`).
- [`lib/orders.ts`](frontend/lib/orders.ts) ⭐ — now hits real `GET /api/my-tickets` with cookie forwarding. Order type renamed `totalCents` → `totalLps` to match schema; `formatOrderTotal` updated. Placeholder data deleted.
- `/seats`, `/checkout`, `/success`, `/my-tickets` all gated with `await requireUser(...)`.
- `/seats` SSR parallel-fetches holds and flips user-owned held seats back to `available` (the read path doesn't know whose hold it is).
- `/signin` bounces already-signed-in users to `next` (default `/seats`).
- [`EmailAuthForm`](frontend/app/components/EmailAuthForm.tsx) POSTs JSON to backend with `credentials: "include"`; displays `{error}` from the response.
- [`OAuthButton`](frontend/app/components/OAuthButton.tsx) href = `${BACKEND_URL}/api/auth/google?next=…`.
- `/success` reads `guestName` from the live session user.
- ⭐ [`CheckoutClient.tsx`](frontend/app/components/CheckoutClient.tsx) — screenshot upload form; POSTs multipart to `/api/checkout/verify`. On approval navigates to `/success?seats=…&order=…`. 401 → `/signin?next=/checkout`, 410 → `/seats`, 402 rejection renders inline feedback.

### Real layout adjustments (this session)

- `MASTER_COLS` bumped 18 → 19 so row I's aisle (gap-width 2) fits — also required widening `grid-template-columns` in [`SeatGrid.tsx`](frontend/app/components/SeatGrid.tsx) to `repeat(19,1fr)`. Otherwise seat I17 silently dropped from the render.
- Row `startCol` values shifted to match the venue diagram: **A–G start at col 6**, **H starts at col 4** (I unchanged at 1). Updated in BOTH [`frontend/lib/seats.ts`](frontend/lib/seats.ts) `ROW_LAYOUTS` *and* [`backend/prisma/seed.ts`](backend/prisma/seed.ts). Re-seed (`npm run db:seed` — idempotent upsert) was run to pick up new `col` values.

## What's built (frontend, all surfaces in the original brief)

```
frontend/
├── app/
│   ├── layout.tsx                html lang="es", font loading, skip-link
│   ├── globals.css               @theme tokens + hero-blend-right/-bottom + seat-hatch-* + drop-cap
│   ├── page.tsx                  Landing — generateMetadata from movie data
│   ├── seats/page.tsx            Seat picker server entry: parallel getMovie() + getSeats()
│   ├── checkout/page.tsx         Pre-Stripe confirmation: reads ?seats&expires
│   ├── success/page.tsx          Per-seat ticket stubs, reads ?seats&order
│   ├── my-tickets/page.tsx       Order history stack
│   ├── signin/page.tsx           Google OAuth + email/password
│   ├── cancel/page.tsx           Stripe cancel landing
│   └── components/
│       ├── Header.tsx / SeatsHeader.tsx
│       ├── Hero.tsx              Uses CoverArt (real album cover)
│       ├── CoverArt.tsx          ⭐ Album cover with CSS-masked starfield (disc only)
│       ├── PosterPlaceholder.tsx (UNUSED — kept around, can delete)
│       ├── ProgrammerNote.tsx
│       ├── Tracklist.tsx
│       ├── Footer.tsx
│       ├── ErrorFallback.tsx
│       ├── SeatPickerApp.tsx
│       ├── SeatGrid.tsx          ⭐ Brighter off-white borders (border-bulb/40 idle)
│       ├── SeatLegend.tsx        Tones updated to match
│       ├── HoldTimer.tsx
│       ├── CartPanel.tsx          ⭐ +conflictNotice slot for race-loss feedback
│       ├── CheckoutClient.tsx     ⭐ Hits real POST /api/checkout → Stripe-hosted URL
│       ├── TicketStub.tsx        ⭐ Per-seat stub: serif ID, mono stamps, Gold frame
│       ├── ResendEmailButton.tsx ⭐ Ghost/inline variants, mocked
│       ├── OrderCard.tsx         ⭐ Ash-framed order card (one per order)
│       ├── OAuthButton.tsx       ⭐ Google only (GitHub dropped)
│       ├── EmailAuthForm.tsx     ⭐ Sign-in / sign-up toggle, inline NAMES field on signup
│       └── CancelClient.tsx      ⭐ Active vs expired hold variants, ticks timer
├── lib/
│   ├── copy.ts                   Now includes success / myTickets / signin / cancel namespaces
│   ├── movie.ts
│   ├── seats.ts                  PRICE_PER_SEAT_LPS, formatTotalLPS, formatPriceLPS
│   ├── orders.ts                 ⭐ Real getMyOrders() — calls /api/my-tickets, cookie-forwarded. totalLps (not totalCents)
│   ├── holds.ts                  ⭐ Browser client for POST/DELETE /api/holds with typed error reasons
│   ├── format.ts
│   └── useCountdown.ts
└── public/
    └── cover.jpg                 ⭐ Album cover used by CoverArt (was a WhatsApp upload, renamed)
```

⭐ = new or significantly changed this session.

### Landing (`/`)
Hero now uses the real album-cover JPG. `CoverArt` masks the image with a radial CSS gradient (`#000 0–47%`, transparent by 52%) centered at the disc, killing the starfield/Earth/lens flare so only the CD blends on Hall Black. Cover anchored right and bleeds slightly off-screen on `sm+`, full-bleed on mobile. `hero-blend-right` (heavy left-side darken + soft top/bottom) keeps the title block readable. Programmer's note + four-row tracklist + fórmula + venue + map-link unchanged.

### Seat picker (`/seats`)
Real **SALA 4** layout (121 seats / 9 rows / 18-col master grid). Four seat states with pattern-plus-color. **Borders brightened this session**: idle `border-bulb/40`, hover `border-bulb`; held `border-bulb/30` over hatch; taken `border-bulb/20` over denser hatch. Numbers were briefly added then removed per user preference — accessible glyph stays centered at ⅔ tile. Keyboard nav unchanged. Max-8 enforcement. 10-min client-side hold timer.

### Checkout (`/checkout`)
Reads `?seats=A1,A2&expires=<ms>`. Marquee block, mono seat-price table, bank transfer instructions, screenshot upload field, `PAGAR · $X.XX LPS` Marquee Gold CTA. On submit POSTs multipart to `/api/checkout/verify`; spinner while Claude verifies. On approval navigates to `/success?seats=…&order=…`. 401 bounces to `/signin?next=/checkout…`; 410 (expired holds) bounces to `/seats`; 402 (rejected) surfaces an inline rejection message with a retry path.

### Success (`/success`) — new this session
Reads `?seats&order`. Welcome block (eyebrow + heading + body) → per-seat stubs → toolbar. Each `TicketStub` is a vertical card with a thin Marquee Gold frame, serif seat ID centerpiece (e.g. `C·7`), and mono operationalia (`A NOMBRE DE`, showtime, venue, `ORDEN`). Slight alternating ±0.6° tilt at `sm+`, collapsed under `prefers-reduced-motion`, straightens on hover. Toolbar has `REENVIAR CORREO` (`ghost` variant) + `VER MIS BOLETOS →`. Empty fallback when params are missing.

### My tickets (`/my-tickets`)
Stack of `OrderCard` rows (one per order — **not** per seat). Each card: serif title, mono date/venue, mono stamps (`BUTACAS`, `ORDEN`, `TOTAL`), inline-variant `REENVIAR CORREO`, and `VER ENTRADAS →` link back to `/success?seats=…&order=…` for that order. Past orders dim to 55%, hide the resend, tag `FUNCIÓN PASADA`. Sorted upcoming-then-past. Empty state with `IR AL CINE →`. Error state with `REINTENTAR`. **⭐ Now backed by real `GET /api/my-tickets`** ([lib/orders.ts](frontend/lib/orders.ts)). Orders reach `paid` when `POST /api/checkout/verify` succeeds.

### Sign in (`/signin`) — new this session
Centered card. Wordmark + eyebrow + heading/body + Google OAuth button + `O CON CORREO` divider + `EmailAuthForm`. The form toggles between `signin` and `signup` modes (`¿AÚN NO TIENES CUENTA? CREAR CUENTA →`); signup mode reveals a `NOMBRE COMPLETO` field. All three inputs (name, email, password) follow DESIGN.md: transparent fill, 1px Ash bottom border, focus shifts border to Marquee Gold, labels above in the Label type style. Submit is mocked (1.2s lock → `router.push(next)`). `?next=` sanitized via allow-list to defuse open redirects. **GitHub OAuth dropped this session.**

### Cancel (`/cancel`) — new this session
Reads `?seats&expires`. `CancelClient` ticks the timer and swaps between two variants without re-fetching:
- **Active hold** — heading + body + seat readout + timer + dual CTAs (`VOLVER AL PAGO →` gold, `MODIFICAR BUTACAS` text link).
- **Expired** — dim seat readout + single gold `ELEGIR BUTACAS →`.

No auto-redirect; the user landed here on purpose. Generic active fallback when no params.

## Payments — bank transfer + AI verification

Customer uploads a screenshot on `/checkout`. The backend calls Claude
Sonnet 4.6 to verify it (synchronous, 30s soft cap). On approval the holds
become Tickets in one transaction, signed QR payloads are generated per
seat, and the customer gets a confirmation email with inline QR PNGs.
Door staff scan at `/admin/scan`; admins manage manual check-in at
`/admin/door`. Screenshots are never persisted — held in memory only for
the LLM call + an archive email.

Design spec: [docs/superpowers/specs/2026-06-02-payment-pivot-design.md](docs/superpowers/specs/2026-06-02-payment-pivot-design.md)
Implementation plan: [docs/superpowers/plans/2026-06-02-payment-pivot.md](docs/superpowers/plans/2026-06-02-payment-pivot.md)

## Recent session decisions (current session — phases 4, 5, 8)

- **Phase 4 (holds) shipped.** `POST /api/holds` uses replace-semantics: drops the user's prior holds + atomically claims the new set inside one Prisma transaction. Race protection rides on the existing `@@unique` on `SeatHold.seatId` (P2002 → 409 with `conflictSeatIds`). Separate error reasons for `conflict` / `sold` / `missing`. `SeatPickerApp` syncs on a 350ms debounce with a `syncSeq` last-write-wins guard; on conflict it greys the lost seat, trims the cart, surfaces a notice, and re-syncs. On unmount/empty/expired it `DELETE`s. `/seats` SSR pulls `GET /api/holds/me` in parallel and flips user-owned `held` seats back to `available` so the user can edit their own selection (otherwise the read path marks them held for everyone).
- **Phase 8 (`GET /api/my-tickets`) shipped.** The pre-existing `requireUser` gate at the route level was already correct — the gap was that `getMyOrders()` had no real backend endpoint to call and didn't forward cookies. New endpoint groups paid orders → tickets → seats → movie, derives `upcoming`/`past` from `movie.startsAt`. Frontend `Order.totalCents` → `totalLps` rename to match the schema's actual unit.
- **Phase 5 (bank transfer + AI verification) shipped.** `POST /api/checkout/verify` accepts a multipart upload, calls ClaudeVerifier (Claude Sonnet 4.6 via Anthropic SDK), converts holds → tickets in one transaction on approval, generates HMAC-SHA256-signed QR payloads per seat, and fires a confirmation email with inline QR PNGs. Screenshots are never written to disk.
- **Schema: added `Order.code`** (6-char unique). Migration `20260521120000_order_code` written manually (not via `prisma migrate dev` — that command requires interactive TTY in this environment) and applied via `prisma migrate deploy`. The cuid is still the FK; `code` is what prints on stubs and reads off `?order=`.

## Recent session decisions worth remembering (prior sessions)

- **All four queued frontend surfaces (`/success`, `/my-tickets`, `/signin`, `/cancel`) built this session** — the frontend brief from the prior session is now complete.
- **Hero swapped to the real album cover** (`/public/cover.jpg`). The starfield/Earth/flare are killed with a radial CSS mask so only the CD shows, blending into Hall Black. The original `hero-overlay` was replaced with `hero-blend-right` (sm+) and `hero-blend-bottom` (mobile).
- **GitHub OAuth dropped.** Sign-in is now Google + email/password. The backend `User` model will need a `passwordHash` column and should treat `provider="email"` as a first-class case alongside `"google"`.
- **USD → LPS rename completed.** `PRICE_PER_SEAT_USD` → `PRICE_PER_SEAT_LPS`, `formatTotalUSD` → `formatTotalLPS`, `formatPriceUSD` → `formatPriceLPS`. All consumers swept. `copy.checkout.payCta` parameter renamed `totalUsd` → `total`.
- **Seat tile borders brightened to off-white** for visibility. Idle `border-bulb/40`, hover `border-bulb`, held `border-bulb/30`, taken `border-bulb/20`. Seat numbers were trialed mid-session and removed at user request.
- **Order ID is synthesized client-side** (`mockOrderId()` in `CheckoutClient`) and threaded through `/success` and `/my-tickets`. Backend phase 5/6 will own real order IDs.
- **QR codes added** (payment pivot). Each ticket now carries an HMAC-SHA256-signed payload; door staff scan at `/admin/scan`, admins manage check-in at `/admin/door`.

## Open items (next session)

**Phases 1–5 + 8 are done.** The payment-pivot plan (tasks 1–18) is complete.

### Backend phases pending

6. **Admin mark-paid override** (optional) — a manual `POST /api/admin/orders/:code/mark-paid` surface for edge-case cash payments. The webhook-on-approval path already handles the normal flow.

### Things to remember for remaining work

- `requireAuth` middleware is exported from [`backend/src/auth/routes.ts`](backend/src/auth/routes.ts) — already in front of `/api/holds`, `/api/checkout`, `/api/my-tickets`. Drop it on `/api/orders/*` too.
- `seatStatus.ts` already does a lazy purge of expired holds on every `GET /api/seats` — anything downstream gets this for free.
- `Order.guestName` is already snapshotted from `User.name` at order-creation time in `services/checkout.ts:create`.
- `Order.code` is a `nanoid(6)` with alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. **This** is what's printed on stubs and what `/success?order=…` should carry going forward.
- CORS in dev allows both `:3000` and `:3001` (Next picks the next free port). Prod will need a single explicit origin.

### Frontend smaller follow-ups

- **`PosterPlaceholder.tsx` is unused** now that `Hero` uses `CoverArt`. Delete or keep as reference.
- **Header has no signed-in indicator / logout button.** Add a small `<UserMenu>` (name + logout) once phase 4 begins — the `/api/auth/logout` endpoint is live.
- **`OAuthButton` glyph is a stylized monochrome G.** Replace with the official multi-color G if/when brand approval comes through.
- **DESIGN.md is still seeded** (`<!-- SEED -->`). Re-run `/impeccable document` in scan mode once the visual system is fully settled.

## How to run

First-time setup:

```bash
# Postgres
cd /Users/alejandro/Desktop/Cuatro
docker compose up -d

# Backend
cd backend
npm install
cp .env.example .env          # already done; only re-do if you wiped backend/
npx prisma migrate dev        # applies init + movie_fields migrations
npm run db:seed               # idempotent: 1 movie + 121 seats
```

Daily run (two terminals):

```bash
# terminal 1 — backend
cd backend && npm run dev     # http://localhost:4000

# terminal 2 — frontend
cd frontend && npm run dev    # http://localhost:3000 (or :3001 if 3000 is busy)
```

Useful one-offs:

```bash
# Browse data
cd backend && npx prisma studio

# Reset dev DB (drops everything, re-applies migrations, re-seeds)
cd backend && npx prisma migrate reset --force

# Typecheck
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

To enable Google OAuth locally:
1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials (Web app).
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
3. Drop `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into `backend/.env` and restart. Until then `/api/auth/google` returns 503.

End-to-end click-through (backend required for everything past `/`):

```
/                          → CTA goes to /signin?next=/seats
/signin                    → Google OAuth (503 unless env set) OR email signup/signin (REAL)
/seats                     → 121 real seats from DB, all "available" on first run
/checkout?seats=…&expires= → upload transfer screenshot → POST /api/checkout/verify
                              → Claude Sonnet 4.6 verifies → QR tickets + confirmation email
/success?seats=…&order=…   → per-seat ticket stubs printed with the session user's name
/my-tickets                → real /api/my-tickets — empty until phase 6 webhook lands
/cancel?seats=…&expires=…  → manual visit; active or expired variant
```

To exercise terminal states locally:
- **Landing states**: edit the movie row in Prisma Studio (set `startsAt` in the past for `"passed"`; mass-insert Tickets to test `"sold-out"`).
- **Landing error fallback**: stop the backend (`/api/movie` will fail).
- **My-tickets empty state**: the *default* for every test account right now (no orders ever reach `paid` until phase 6). To exercise the *populated* layout, manually insert via `npx prisma studio`: create an Order (status=paid, code=`ABC123`, totalLps=24, guestName=<your name>) + two Tickets pointing at that order + free seats + your userId.
- **Cancel active/expired**: visit `/cancel?seats=C7,C8&expires=<now+30000>` and wait.

### Test accounts created during this session

- `alejandro21232@gmail.com` (email/password) — created during phase 3 verification.
- `wire@test.com` (email/password) — created during the frontend wire-up verification.

Both are in the dev DB. Reset with `prisma migrate reset --force` if you want a clean slate.

## Useful pointers

- Impeccable plugin SKILL: `~/.claude/plugins/marketplaces/local-desktop-app-uploads/impeccable/.claude/skills/impeccable/SKILL.md`
- Payment design spec: [`docs/superpowers/specs/2026-06-02-payment-pivot-design.md`](docs/superpowers/specs/2026-06-02-payment-pivot-design.md)
- Payment implementation plan: [`docs/superpowers/plans/2026-06-02-payment-pivot.md`](docs/superpowers/plans/2026-06-02-payment-pivot.md)

## Files at the project root

| File | Role |
|---|---|
| `PRODUCT.md` | Strategic context, register, principles, anti-references |
| `DESIGN.md` | Seed visual system, North Star, named rules, OKLCH tokens (high-level) |
| `PLAN.md` | Original 10-phase implementation plan (backend roadmap) |
| `HANDOFF.md` | This file |
| `docker-compose.yml` | Postgres 16 on host port 5433 (volume `cuatro-pgdata`) |
| `frontend/` | Next.js 15 app (landing + seats + checkout + success + my-tickets + signin + cancel) — all routes except `/`/`/signin`/`/cancel` are auth-gated |
| `backend/` | Express 5 + Prisma + Passport (phases 1–5 + 8 done; bank-transfer + AI verification flow complete) |
