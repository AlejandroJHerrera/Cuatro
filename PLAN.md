# Movie Ticketing Site — Implementation Plan

## Context

Build a production-grade web app for selling tickets to a **single movie function** (one screening). Customers create accounts via OAuth, view an interactive seat map, select available seats with a short-lived hold, pay via Stripe (test mode), and receive a ticket both on-screen and by email with a QR code for venue check-in.

The directory `/Users/alejandro/Desktop/Cuatro` is currently empty — this is a fresh project.

## Decisions (from brainstorming)

| Area | Decision |
|------|----------|
| Frontend | Next.js (App Router, TypeScript) |
| Backend | Express (TypeScript), separate API server |
| Database | PostgreSQL via Prisma ORM |
| Auth | OAuth (Google + GitHub) only, via Passport.js, session cookie |
| Seating | Fixed 10×12 grid seeded in DB (seats A1–J12, single tier) |
| Concurrency | Temporary seat hold (10 min) during checkout |
| Payment | Stripe Checkout in test mode + webhook for confirmation |
| Movie data | One hardcoded movie record (seed) |
| Ticket delivery | On-screen success page + email with PDF/QR (Resend) |

## Architecture

```
/Users/alejandro/Desktop/Cuatro/
├── backend/          Express API + Prisma + Stripe webhook + email
├── frontend/         Next.js (App Router, RSC + client components)
├── docker-compose.yml   Postgres (dev) + optional Mailhog
└── README.md
```

Two processes:
- **backend** on `:4000` — REST API, OAuth callbacks, Stripe webhook
- **frontend** on `:3000` — Next.js UI, calls backend via `fetch` with credentials

Session: backend issues an `httpOnly`, `SameSite=Lax` session cookie on OAuth success. Frontend reads identity via `GET /api/me`.

## Data Model (Prisma)

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  avatarUrl     String?
  provider      String   // "google" | "github"
  providerId    String
  createdAt     DateTime @default(now())
  orders        Order[]
  holds         SeatHold[]
  @@unique([provider, providerId])
}

model Movie {
  id        String   @id @default(cuid())
  title     String
  posterUrl String
  synopsis  String
  startsAt  DateTime
  priceCents Int
  seats     Seat[]
}

model Seat {
  id      String @id @default(cuid())
  movieId String
  movie   Movie  @relation(fields: [movieId], references: [id])
  row     String // "A".."J"
  col     Int    // 1..12
  label   String // "A1"
  ticket  Ticket?
  hold    SeatHold?
  @@unique([movieId, row, col])
}

model SeatHold {
  id        String   @id @default(cuid())
  seatId    String   @unique
  seat      Seat     @relation(fields: [seatId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model Order {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  stripeSessionId String   @unique
  status          String   // "pending" | "paid" | "failed" | "expired"
  totalCents      Int
  tickets         Ticket[]
  createdAt       DateTime @default(now())
}

model Ticket {
  id        String @id @default(cuid())
  orderId   String
  order     Order  @relation(fields: [orderId], references: [id])
  seatId    String @unique
  seat      Seat   @relation(fields: [seatId], references: [id])
  userId    String
  qrToken   String @unique  // random opaque token for QR
  createdAt DateTime @default(now())
}
```

A seat is **available** iff it has no `Ticket` and no non-expired `SeatHold`.

## API Endpoints (Express)

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/auth/google` | Start Google OAuth |
| GET  | `/auth/google/callback` | Google OAuth callback → set session cookie |
| GET  | `/auth/github` | Start GitHub OAuth |
| GET  | `/auth/github/callback` | GitHub OAuth callback |
| POST | `/auth/logout` | Clear session |
| GET  | `/api/me` | Current user or 401 |
| GET  | `/api/movie` | Movie details |
| GET  | `/api/seats` | All seats with status: `available` / `held` / `sold` |
| POST | `/api/holds` | Body: `{seatIds: []}`. Create holds for current user (atomic, all-or-fail). Returns hold expiry. |
| DELETE | `/api/holds` | Release current user's holds |
| POST | `/api/checkout` | Create Stripe Checkout Session for current user's active holds. Creates `Order(status=pending)`. Returns `checkoutUrl`. |
| POST | `/api/stripe/webhook` | Verify signature; on `checkout.session.completed`: mark order paid, convert holds → tickets in a transaction, send email. |
| GET  | `/api/my-tickets` | Current user's tickets (with QR token). |

### Concurrency rules (critical)

`POST /api/holds` runs in a **single Prisma transaction**:
1. For each seatId: ensure no `Ticket` exists AND no `SeatHold` with `expiresAt > now()` exists.
2. Insert holds with `expiresAt = now() + 10 min`.
3. Rely on `@@unique` on `SeatHold.seatId` to make races crash one transaction — return 409 with the conflicting seats so the UI can refresh.

A lazy sweep on every read: `DELETE FROM SeatHold WHERE expiresAt < now()` before returning seat status (cheap; <120 rows).

Stripe webhook is the **only** path that converts holds to tickets — never trust the client redirect to success page.

## Frontend Pages (Next.js App Router)

| Route | Purpose |
|-------|---------|
| `/` | Movie poster, title, showtime, "Book seats" CTA. Redirects to `/login` if not authed. |
| `/login` | Two buttons: Continue with Google / GitHub. |
| `/seats` | Interactive seat grid. Toggles seat selection. "Continue to payment" calls `POST /api/holds` then `POST /api/checkout`, redirects to Stripe. |
| `/success?session_id=...` | Polls `/api/my-tickets` until tickets appear (webhook may be a beat behind). Shows QR codes. |
| `/cancel` | User cancelled at Stripe — release holds, return to `/seats`. |
| `/my-tickets` | List of all purchased tickets with QR codes. |

Seat grid component (`SeatGrid`):
- 10 rows × 12 cols, screen indicator at top
- Each seat colored: green (available) / yellow (your hold/selection) / gray (held by someone) / red (sold)
- Click toggles selection (only on available seats)
- Disables "Continue" if 0 selected or > max (e.g., 8)

## External integrations

- **Stripe**: `stripe` Node SDK. Single Price created dynamically per checkout (line_items with `price_data`, quantity = seat count). Webhook secret in env.
- **Email (Resend)**: After webhook marks order paid, send HTML email per order with movie info + each seat label + a QR image (base64 PNG generated server-side with `qrcode` package, encoding the `qrToken`). Also attach a simple PDF (optional v2; v1 = HTML + inline QR is fine).
- **OAuth**: `passport`, `passport-google-oauth20`, `passport-github2`. Sessions via `express-session` with a Postgres-backed store (`connect-pg-simple`).

## Project structure

```
backend/
├── src/
│   ├── index.ts            Express bootstrap
│   ├── env.ts              zod-validated env
│   ├── db.ts               Prisma client
│   ├── auth/
│   │   ├── passport.ts     Google + GitHub strategies
│   │   └── routes.ts
│   ├── routes/
│   │   ├── movie.ts
│   │   ├── seats.ts
│   │   ├── holds.ts
│   │   ├── checkout.ts
│   │   ├── webhook.ts      Stripe webhook (raw body!)
│   │   └── tickets.ts
│   ├── services/
│   │   ├── seatStatus.ts   Compute available/held/sold
│   │   ├── stripe.ts
│   │   └── email.ts        Resend + qrcode
│   └── middleware/
│       └── requireAuth.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts             Insert 1 movie + 120 seats
├── package.json
└── tsconfig.json

frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  Landing
│   ├── login/page.tsx
│   ├── seats/page.tsx
│   ├── success/page.tsx
│   ├── cancel/page.tsx
│   └── my-tickets/page.tsx
├── components/
│   ├── SeatGrid.tsx
│   ├── Seat.tsx
│   └── AuthButtons.tsx
├── lib/api.ts                    fetch wrapper with credentials: 'include'
├── package.json
└── next.config.ts
```

## Environment variables

`backend/.env`:
```
DATABASE_URL=postgresql://...
SESSION_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=...
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:4000
```

`frontend/.env.local`:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

## Production considerations

- CORS: backend allows only `FRONTEND_URL` with `credentials: true`.
- Cookies: `secure` + `SameSite=None` in production (frontend and backend on different domains) or same-site deployment (e.g., both behind a reverse proxy).
- Run Stripe webhook on a route mounted **before** `express.json()` and use `express.raw({type: 'application/json'})` for signature verification.
- Add a cron (or `pg_cron`) job to purge expired holds hourly — not required for correctness, just cleanliness.
- Rate-limit `POST /api/holds` per user (e.g., 30/min) to prevent griefing.

## Build phases (suggested execution order)

1. Scaffold monorepo, docker-compose Postgres, Prisma schema + seed.
2. Backend: env, Prisma client, Express bootstrap, `/api/movie`, `/api/seats`.
3. Frontend: landing page, seat grid (read-only first), API client.
4. Auth: Passport Google + GitHub, sessions, `/api/me`, login page.
5. Holds: `POST/DELETE /api/holds` with transactional integrity + UI selection.
6. Stripe Checkout: `/api/checkout`, redirect flow, `/cancel` page.
7. Stripe webhook: convert holds → tickets in transaction.
8. Email + QR: Resend integration, QR generation, send on webhook.
9. `/success` and `/my-tickets` pages.
10. Polish: error states, loading skeletons, hold-expiry countdown timer in UI.

## Verification (end-to-end)

Local checklist before declaring done:
- `docker compose up -d` brings up Postgres
- `pnpm --filter backend prisma migrate dev && pnpm --filter backend prisma db seed` creates 1 movie + 120 seats
- `pnpm --filter backend dev` and `pnpm --filter frontend dev` both run
- Visit `localhost:3000`, sign in with Google → land on `/seats`
- Select 2 seats → "Continue" → land on Stripe Checkout (test mode)
- Pay with `4242 4242 4242 4242` → webhook fires (use `stripe listen --forward-to localhost:4000/api/stripe/webhook`)
- `/success` shows two QR codes; email arrives via Resend
- Open `/seats` in an incognito window — the two seats are now red (sold)
- Open two browsers, both try to hold seat A1 → second receives 409
- Start a hold, wait 10 minutes without paying → seat returns to available

## Open items to confirm before implementation

- ~~Max seats per order~~ → **8** (confirmed)
- ~~Currency / price~~ → **USD $12.00 (1200¢)** (confirmed)
- Movie seed: placeholder row; real title/poster/synopsis/showtime filled in later via Prisma Studio. The documentary is for the album **"CUATRO"** by **Jose Javier Diaz** (4 tracks tied to seasons + cardinal directions).

---

# Frontend Design — "Cosmic Cinema"

## Aesthetic

Inspired by the album poster: a CD floating against deep space with an Earth horizon and a soft blue lens flare.

**Palette**
| Token | Value | Use |
|-------|-------|-----|
| `--bg-deep` | `#05070d` | Page background (near-black, slight blue tint) |
| `--bg-panel` | `#0c1220` | Cards, modals, seat map container |
| `--accent` | `#5aa7ff` | Primary action color (the lens-flare blue) |
| `--accent-glow` | `rgba(90,167,255,0.35)` | Box-shadows, seat hover halo |
| `--text` | `#e8ecf3` | Body text (warm white, not pure) |
| `--text-dim` | `#8892a6` | Secondary text |
| `--seat-available` | `#3a8fff` | Selectable seat |
| `--seat-selected` | `#ffd166` | Warm gold — user's selection (echoes the CD center) |
| `--seat-held` | `#3a3f4a` | Held by someone else (dim) |
| `--seat-sold` | `#1a1d24` | Sold (almost invisible — empty space) |

**Background treatment.** Body uses a fixed CSS background: deep navy + a subtle 1px-dot starfield (SVG noise) + a soft radial blue glow in the top-left (matching the poster's lens flare). Stars are decorative only, no animation by default (respect `prefers-reduced-motion`).

**Typography**
- Headings: **Cormorant Garamond** (or similar serif with high contrast) — `font-weight: 500`, `letter-spacing: 0.15em`, **uppercase** for hero titles like the poster's "CUATRO".
- Body / UI: **Inter** (system sans fallback) at 15–16px, comfortable line-height 1.55.
- Numerals (seat labels, prices, countdown): **tabular** (`font-variant-numeric: tabular-nums`).

**Spacing & motion**
- Generous negative space — pages breathe. Max content width ~960px centered.
- Subtle 150ms ease transitions on hover. No bouncy animations.
- Buttons: outlined rectangles with thin border + faint glow on hover (no fills until pressed).

---

## Page sketches

### `/` — Landing

```
┌────────────────────────────────────────────────────────────┐
│  starfield + blue flare top-left                           │
│                                                            │
│              [ tiny nav: Cuatro · Iniciar sesión ]         │
│                                                            │
│                                                            │
│       ┌──────────────┐                                     │
│       │              │   CUATRO                            │
│       │   POSTER     │   ──────                            │
│       │   (320×320)  │   Un documental sobre el álbum      │
│       │              │   de Jose Javier Diaz               │
│       └──────────────┘                                     │
│                                                            │
│                       Función única · DD MMM · HH:MM       │
│                       Sala Auditorio · $12.00 USD          │
│                                                            │
│                       [ Reservar asientos → ]              │
│                                                            │
│                                                            │
│      “Cuatro canciones, cuatro estaciones,                 │
│       cuatro horizontes.”                                  │
│                                                            │
│        01 · Al Oriente Primavera                           │
│        02 · Verano bogando al Norte                        │
│        03 · Otoño mirando al Sur                           │
│        04 · Risas de Invierno al Occidente                 │
└────────────────────────────────────────────────────────────┘
```
Hero is split: poster left, copy right. Below the fold, the four tracks listed in serif with thin dividers, like the poster's tracklist. Spanish copy as default (the artist is Spanish-speaking — confirm).

### `/login`

```
                    CUATRO
                    ──────
              Inicia sesión para reservar

         ┌──────────────────────────────┐
         │   Continuar con Google       │
         └──────────────────────────────┘
         ┌──────────────────────────────┐
         │   Continuar con GitHub       │
         └──────────────────────────────┘

           No se almacenan contraseñas.
```
Centered card, ~360px wide, faint border. Each button has the provider logo on the left.

### `/seats` — Seat selection (the centerpiece)

```
   < Volver                                  Hola, Alejandro  ▾
   ────────────────────────────────────────────────────────────
                          CUATRO
                Función · 25 MAY · 19:30
   ────────────────────────────────────────────────────────────

                  ╭──────────  PANTALLA  ──────────╮
                   ·······························
                   (subtle gradient glow from screen)

         A  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●
         B  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●
         C  ●  ●  ●  ●  ◆  ◆  ●  ●  ●  ●  ●  ●    ◆ = tu selección
         D  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●    ● = libre
         E  ●  ●  ▢  ▢  ●  ●  ●  ●  ●  ●  ●  ●    ▢ = en espera
         F  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●    ✕ = vendido
         G  ●  ●  ●  ●  ●  ●  ✕  ✕  ●  ●  ●  ●
         H   ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●   ← slight indent
         I    ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●   ← rows curve
         J     ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ●  ← away from screen

         1  2  3  4  5  6  7  8  9 10 11 12

   ────────────────────────────────────────────────────────────
   Seleccionados: C5, C6                              2 × $12.00
   Mantén tu selección durante 10:00                  Total $24.00
                                                [ Continuar al pago → ]
```

**Visual details**
- Seats are 28px circles, 12px gap.
- Curve effect: rows H, I, J are translated horizontally by a few px (CSS `transform: translateX(...)`) to suggest perspective without 3D.
- "PANTALLA" (screen) bar at top is a 4px-tall gradient (transparent → `--accent` → transparent) with a soft glow blooming downward, hinting that the rows are facing it.
- Hovering a seat lifts it 2px with a `--accent-glow` shadow.
- Sold seats use `--seat-sold` (almost background-colored) so the eye scans only what's available.
- The selection summary footer is sticky at the bottom on mobile, inline on desktop.
- Countdown timer ("10:00" → "09:59 …") appears only after the user clicks **Continuar** — that's when the hold is actually created. Before that, selection is local state only.

**Limits**
- Disable "Continuar al pago" when 0 or > 8 selected. Show inline error: *"Máximo 8 asientos por compra."*

### Stripe Checkout
External Stripe-hosted page — no custom design needed. We pass `success_url=/success?session_id={CHECKOUT_SESSION_ID}` and `cancel_url=/cancel`.

### `/success`

```
                  ✓  Compra confirmada
                  ─────────────────────
            CUATRO · 25 MAY · 19:30 · Sala Auditorio

          ┌───────────────┐     ┌───────────────┐
          │   ┌───────┐   │     │   ┌───────┐   │
          │   │ QR    │   │     │   │ QR    │   │
          │   └───────┘   │     │   └───────┘   │
          │   Asiento C5  │     │   Asiento C6  │
          └───────────────┘     └───────────────┘

           También te enviamos los tickets por correo.

                    [ Ver mis tickets ]
```
Each ticket is a card ~240px wide with a thin gold border (`--seat-selected` color, tying back to the chosen-seat hue). QR is 160×160 pure black on white (for scanner reliability).

While the webhook is in flight (a beat after Stripe redirect), show a centered spinner with the message *"Confirmando tu compra…"* and poll `/api/my-tickets` every 1.5s, up to 20s before showing a friendly fallback.

### `/cancel`
Single line: *"Tu compra fue cancelada. Los asientos siguen disponibles."* + button back to `/seats`. Frontend also fires `DELETE /api/holds` on mount.

### `/my-tickets`
Same card layout as `/success`, paginated by purchase date if needed (unlikely for a single-function site).

---

## Component contracts

| Component | Props (TS) | Responsibility |
|-----------|------------|----------------|
| `SeatGrid` | `seats: Seat[]`, `selected: string[]`, `onToggle(id)` | Pure render + click handling. No fetching. |
| `Seat` | `status: 'available'\|'selected'\|'held'\|'sold'`, `label`, `onClick` | Single seat circle + a11y (`aria-label="Fila C asiento 5, disponible"`). Keyboard activatable (`Enter`/`Space`). |
| `HoldCountdown` | `expiresAt: Date` | mm:ss countdown; emits `onExpire` |
| `MovieHeader` | `movie: Movie` | Title, showtime, price chip |
| `AuthButtons` | – | Two OAuth links |
| `TicketCard` | `ticket: Ticket` | QR + seat label |

`SeatGrid` is presentation-only; the page composes it with data from `/api/seats` and selection state. This is the boundary that keeps the visually-busy bit testable in isolation.

## Accessibility

- All seat buttons are real `<button>` elements with descriptive `aria-label`s and visible focus rings (2px `--accent`).
- Color isn't the only signal: selected seats also have a 2px gold ring; sold seats use both color *and* a strike-through pattern (subtle SVG ✕).
- Page meets WCAG AA contrast on `--text` over `--bg-deep` (verified: ~14:1).
- `prefers-reduced-motion` disables the hover lift and glow transitions.
- Spanish content uses `lang="es"` on `<html>`; English fallback strings exposed via a single `t()` helper in case localization is later added.

## Out of scope for v1 visual design

- No animated starfield (perf + reduced-motion).
- No dark/light toggle (the brand is dark).
- No mobile-app-style bottom nav — desktop is the primary target; mobile gets the same layout with a single column.

---

## Implementation note

This design will be ported directly into Next.js App Router as the components listed in the original "Project structure" section. CSS will live in `app/globals.css` + per-component CSS modules. No Tailwind for v1 (keeps the cosmic palette and serif typography easier to control); we can revisit if the user prefers.
