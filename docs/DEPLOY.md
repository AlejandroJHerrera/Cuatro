# Cuatro — Production Deploy & Operations Reference

Covers environment variables, first-boot steps, security posture, and the pre-launch checklist.

Stack: **Next.js 15** frontend (Vercel) + **Express 5 / Prisma / Postgres** backend (Railway / Render / Fly).
The browser speaks only to the frontend origin; `/api/*` is proxied to the backend via a Next.js rewrite in `frontend/next.config.ts`.

---

## 1. Backend Production Env Vars

Set these on the backend host (Railway / Render / Fly → Environment tab).

| Variable | Example / value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/cuatro` | Managed Postgres connection string; SSL required on all major hosts. |
| `SESSION_SECRET` | `openssl rand -hex 32` output | **Regenerate for prod.** Rotating this invalidates all active sessions. |
| `QR_SIGNING_SECRET` | `openssl rand -hex 32` output | 32-byte hex; used to sign QR codes. Keep dev value or rotate *before* launch only — rotating after tickets are issued invalidates already-printed codes. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Real key. **Rotate now — this key appeared in dev transcripts.** |
| `RESEND_API_KEY` | `re_…` | Real key. **Rotate now — also appeared in dev transcripts.** |
| `BANK_ACCOUNT_REF` | `BAC · Cuenta 100355841 · José Javier Díaz Alvarado` | Human-readable display string shown at checkout and in payment instructions. |
| `BANK_ACCOUNT_NUMBER` | `100355841` | Digits only. The verifier uses this as its account gate — must match the account in `BANK_ACCOUNT_REF`. |
| `PAYMENT_ARCHIVE_EMAIL` | `pagos@discocuatro.com` | Internal inbox for payment archive emails. |
| `FRONTEND_URL` | `https://discocuatro.com` | Also the sole allowed CORS origin in prod. |
| `BACKEND_URL` | `https://api.discocuatro.com` | Public backend URL used in QR-image links embedded in emails. |
| `NODE_ENV` | `production` | Enables secure cookies and locks CORS to `FRONTEND_URL`. |
| `SENTRY_DSN` | `https://…@sentry.io/…` | Optional. Set to enable backend error monitoring; leave blank to disable. |

---

## 2. Frontend Production Env Vars

Set these on Vercel → Settings → Environment Variables.

| Variable | Example / value | Notes |
|---|---|---|
| `API_URL` | `https://api.discocuatro.com` | Backend URL for server-component direct fetches (server-side only, not bundled). |
| `NEXT_PUBLIC_BACKEND_URL` | *(leave blank)* | Keep blank to preserve the same-origin rewrite pattern (recommended). The browser calls `/api/*` and Next proxies it — no cross-origin requests, no CORS surface. |
| `NEXT_PUBLIC_BANK_ACCOUNT_REF` | `BAC · Cuenta 100355841 · José Javier Díaz Alvarado` | Display string on the checkout instructions card. Bundled into client JS — publicly visible by design. |
| `SENTRY_DSN` | `https://…@sentry.io/…` | Optional server-side DSN. Set together with `NEXT_PUBLIC_SENTRY_DSN` to enable frontend monitoring. |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://…@sentry.io/…` | Optional client-side DSN (same value as `SENTRY_DSN`). Both must be set for full frontend coverage. |

---

## 3. First-Boot Deploy Steps

### Backend

1. **Provision managed Postgres** on Railway, Render, or Fly. Copy the connection string into `DATABASE_URL`.
2. **Set all backend env vars** from Section 1.
3. **Run migrations:**
   ```bash
   npx prisma migrate deploy
   ```
4. **Seed the database** (inserts the movie + 121 seats):
   ```bash
   npm run db:seed
   ```
5. **Promote staff accounts** — have the `admin` and `doorStaff` users sign up via the UI first, then open Prisma Studio and set `User.role` accordingly:
   ```bash
   npx prisma studio
   ```

### Frontend

1. Connect the repo to Vercel (import from GitHub).
2. Set the env vars from Section 2.
3. Deploy. Vercel picks up `frontend/` automatically if the root directory is set correctly.

### Architecture note

Keep the Next.js rewrite proxy (`/api/*` → backend). This means a single origin for the browser, zero CORS surface, and simpler cookie handling. Recommended for v1 and beyond unless a separate mobile app needs direct backend access.

---

## 4. Security / Sessions (Already in Code)

- **Prod cookies** are `secure: true`, `sameSite: lax`, `httpOnly: true`. These are set automatically when `NODE_ENV=production`.
- If you ever split frontend and backend onto **different registrable domains** (e.g. `discocuatro.com` vs `api.different-domain.com`), switch `sameSite` to `none` and ensure `secure: true` remains set.
- **CORS** in prod allows only `FRONTEND_URL`. Any other origin receives a 403.
- **`/api/checkout/verify`** is rate-limited to 10 requests per 10 minutes per user to protect Anthropic spend.
- **Email sends are non-fatal** — a Resend failure logs the error but does not 500 the request. Customers who miss their confirmation can use the resend-email button in the order view.

---

## 5. Pre-Launch Ops Checklist

- [ ] **Rotate leaked credentials** — `ANTHROPIC_API_KEY` and `RESEND_API_KEY` both appeared in dev transcripts. Rotate them in the provider dashboards before going live.
- [ ] **DB backups** — enable nightly automated backups on the Postgres host. Railway, Render, and Fly all offer one-click scheduled backups.
- [ ] **DMARC** — already at `p=none`. After monitoring deliverability for a few weeks, move to `p=quarantine`. Set a real `reply_to` inbox (Cloudflare Email Routing → your Gmail works well).
- [ ] **Health-check ping** — set up UptimeRobot (free tier) hitting `GET /health` every 5 min; configure an alert email or Slack notification on downtime.
- [ ] **Sentry** — set `SENTRY_DSN` (backend) and both `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (frontend). Trigger a test error to confirm events appear in the Sentry dashboard.
- [ ] **Deliverability** — send an order confirmation to a non-owner Gmail and verify it lands in the inbox, not spam. Optionally run the sending domain through [mail-tester.com](https://www.mail-tester.com).
- [ ] **Final real-money smoke test** — complete one genuine bank transfer end-to-end through the real verifier. The customer must include the order code in the transfer's *Descripción* field and pay same-day; confirm the verifier marks the order as paid.
