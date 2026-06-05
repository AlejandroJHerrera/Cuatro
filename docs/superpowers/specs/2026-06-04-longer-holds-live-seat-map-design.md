# Spec: Longer Seat Holds + Live Seat Map

**Date:** 2026-06-04
**Status:** Approved (design), pending spec review
**Author:** session continuation (deployment + hardening)

## Problem

On the `/seats` picker, two risks around concurrent buyers:

1. **Hold expiring mid-transfer.** The seat hold lasts **10 minutes**. A real BAC bank
   transfer (open app → log in → OTP → enter account + amount + order code in *Detalle* →
   confirm → screenshot → return and upload) can take longer than 10 minutes. If the hold
   expires while the customer is at their bank and someone else takes the seat, the customer
   can pay real money and end up with **no seat** — the worst outcome for a charity show.

2. **Stale seat map.** The map is server-rendered once and never refreshes. A second
   customer can see a seat as "available" that another buyer already holds, click it, and
   get bounced by a `409` from `POST /api/holds`. This is friction (not a true double-book —
   the `SeatHold.seatId` unique constraint already prevents two simultaneous holds), but it
   reads as a glitch.

## What is already safe (do NOT change)

- **Simultaneous double-booking is impossible.** `SeatHold.seatId` is `@@unique`; the second
  concurrent hold attempt raises `P2002` → `409`. The database is the source of truth.
- **Finalize-on-payment** (`finalizeOrderAsPaid`) runs at `Serializable` isolation, dedupes
  by `txnId`, and requires an active hold. This stays as-is.

## Non-goals (explicitly out of scope)

- Persisting intended seats on the `Order` (option C) and graceful "we received your payment"
  recovery when a seat is genuinely lost (options D/E). These reduce the residual paid-but-lost
  risk further but are deferred. The accepted fallback for the rare residual case is a **manual
  refund**, which is manageable at single-show scale.
- SSE / WebSockets. Polling is sufficient.

## Changes

### A. Hold duration 10 → 20 minutes

- `backend/src/services/holds.ts`: `HOLD_DURATION_MS = 20 * 60 * 1000`.
- `frontend/lib/seats.ts`: mirror constant bumped to match. The server-issued `expiresAt`
  remains the authoritative countdown source; the frontend constant is a display fallback.
- Audit copy for any literal "10 minutos" / "10 min" references and update to "20".

This shrinks the dangerous window so almost no transfer expires mid-flow.

### B. Live seat map via 5-second polling

Implemented in `frontend/app/components/SeatPickerApp.tsx`.

- **Polling effect.** Every **5 seconds** while the tab is visible, `GET /api/seats` and merge
  the fresh `status` for each seat into the `seats` state.
- **Selection preserved.** Rendering of the customer's own picks is driven by the separate
  `selected` set, not by `seats[].status`. Merging fresh statuses therefore never makes the
  customer's own selected seats look like someone else's hold.
- **Tab-aware.** Pause polling when `document.visibilityState !== "visible"`. On returning to
  visible, fetch once immediately, then resume the interval.
- **Lost-seat reconciliation.** After each poll, for any seat in `selected` whose fresh server
  status is **`taken`** (unambiguous — someone else has paid), drop it from `selected`,
  re-sync the trimmed set to the server, and show a clear notice:
  *"La butaca A5 ya no está disponible — selecciónala de nuevo."*
  Only `taken` triggers an auto-drop. The `held`-by-other ambiguity (the DTO cannot distinguish
  "held by me" from "held by another user") is intentionally left to the existing `flushExpired`
  flow, which clears the whole selection when the customer's own hold lapses.
- **Stale-response guard.** The poll gets its own sequence/abort guard so a slow poll response
  cannot overwrite a newer one. The existing `syncSeqRef` that guards `/api/holds` responses is
  untouched. The poll only writes `seats[].status` (plus the lost-seat drop); it never issues
  hold mutations except the re-sync of a trimmed selection.

## Files touched

| File | Change |
|---|---|
| `backend/src/services/holds.ts` | `HOLD_DURATION_MS` → 20 min |
| `frontend/lib/seats.ts` | mirror constant → 20 min; add `fetchSeats()` client helper (same-origin `GET /api/seats`) |
| `frontend/app/components/SeatPickerApp.tsx` | polling effect + tab-visibility handling + lost-seat reconciliation |
| `frontend/lib/copy.ts` | new lost-seat notice string; update any "10 min" copy to "20" |

## Data flow

```
tab visible ──every 5s──> GET /api/seats ──> merge status into `seats`
                                            └─> selected ∩ {status==="taken"} ?
                                                    └─ drop from selected
                                                    └─ re-sync trimmed set (POST/DELETE /api/holds)
                                                    └─ show "ya no está disponible" notice
tab hidden ──> interval paused ──(on visible)──> immediate fetch, then resume
```

## Error handling / edge cases

- **Poll network blip:** keep the last good map, retry on the next tick. No disruptive error UI.
- **Tab hidden:** no requests; instant refetch on return.
- **Only `taken` auto-drops** (safe/unambiguous). Own-hold expiry handled by existing flow.
- **Empty trimmed selection after a drop:** behaves like a normal "cleared cart" sync
  (`DELETE /api/holds`), consistent with current `syncHolds` semantics.

## Testing & verification

- **Backend:** existing hold tests construct expiries with explicit timestamps, so they remain
  green with the new constant. Confirm `npm test` passes (40 tests).
- **Frontend:** no frontend test harness exists in this project (tests are backend vitest), so
  validate manually:
  1. Two browsers/accounts. Take a seat in browser 1 → browser 2's map reflects it as
     unavailable within ~5s.
  2. Let a hold lapse (or shorten locally) → the seat returns to available on the live map.
  3. Force a selected seat to `taken` (e.g. finalize it from another account) → the holding
     browser drops it from the cart and shows the notice.
  4. Hide the tab → confirm polling stops (network panel); restore → confirm an immediate fetch.

## Rollout

Single deploy. No DB migration. Backend constant change + frontend behavior change ship together
(push to `main` → Railway + Vercel auto-deploy). Backward compatible with the migrated real
orders and in-flight holds.
