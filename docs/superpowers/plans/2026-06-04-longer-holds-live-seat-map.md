# Longer Seat Holds + Live Seat Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the seat hold from 10 to 20 minutes and make the `/seats` map refresh live (5s polling) so concurrent buyers see seats taken in near-real-time and a customer whose seat is lost gets a clear notice.

**Architecture:** Two small, independent changes. (A) Bump the `HOLD_DURATION_MS` constant on backend (authoritative) and frontend (mirror) and the "10 minutos" copy. (B) Add a tab-visibility-aware 5-second poll of `GET /api/seats` to `SeatPickerApp`, merging fresh statuses while preserving the customer's own selection, and dropping any selected seat that has become `taken` with a notice.

**Tech Stack:** Next.js 15 (React 19, App Router, client components), Express 5 + Prisma backend, Vitest (backend only — no frontend test harness).

Spec: `docs/superpowers/specs/2026-06-04-longer-holds-live-seat-map-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `backend/src/services/holds.ts` | Hold lifetime constant (authoritative) | `HOLD_DURATION_MS` → 20 min + comment |
| `frontend/lib/seats.ts` | Mirror constant | `HOLD_DURATION_MS` → 20 min |
| `frontend/lib/copy.ts` | UI copy | "10 minutos" → "20 minutos"; add `lostSeatNotice(label)` |
| `frontend/lib/holds.ts` | Browser hold client | add `fetchSeatsClient()` |
| `frontend/app/components/SeatPickerApp.tsx` | Picker state + holds | add live polling + lost-seat reconciliation |

**Not changed (intentionally):** `backend/src/routes/checkoutVerify.ts:15` (`windowMs: 10*60*1000` is the rate-limiter window, unrelated to holds) and `backend/src/test/factories.ts:49` (`makeHold` default ttl — test-only, any future timestamp works).

---

## Task 1: Backend hold duration → 20 minutes

**Files:**
- Modify: `backend/src/services/holds.ts` (line 2 comment, line 13 constant)

- [ ] **Step 1: Update the constant and its comment**

In `backend/src/services/holds.ts`, change the doc comment line 2 from:

```
 * Seat-hold operations. Hold lifetime is 10 minutes; the lazy purge in
```

to:

```
 * Seat-hold operations. Hold lifetime is 20 minutes; the lazy purge in
```

And change line 13 from:

```ts
export const HOLD_DURATION_MS = 10 * 60 * 1000;
```

to:

```ts
export const HOLD_DURATION_MS = 20 * 60 * 1000;
```

- [ ] **Step 2: Verify the backend still typechecks and tests pass**

Run: `cd backend && npm run typecheck && npm test`
Expected: typecheck clean; **40 tests pass** (no test asserts the hold-duration value, so this is a no-op for the suite — it confirms nothing broke).

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/holds.ts
git commit -m "holds: extend seat hold 10 -> 20 minutes"
```

---

## Task 2: Frontend mirror constant + copy

**Files:**
- Modify: `frontend/lib/seats.ts:65`
- Modify: `frontend/lib/copy.ts:73`

- [ ] **Step 1: Bump the mirror constant**

In `frontend/lib/seats.ts`, change line 65 from:

```ts
export const HOLD_DURATION_MS = 10 * 60 * 1000;
```

to:

```ts
export const HOLD_DURATION_MS = 20 * 60 * 1000;
```

(The server-issued `expiresAt` remains the authoritative countdown; this mirror keeps copy/estimates consistent.)

- [ ] **Step 2: Update the "10 minutos" copy**

In `frontend/lib/copy.ts`, change line 73 from:

```ts
      emptyBody: "Tienes 10 minutos cuando empieces.",
```

to:

```ts
      emptyBody: "Tienes 20 minutos cuando empieces.",
```

- [ ] **Step 3: Verify the frontend typechecks**

Run: `cd frontend && npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/seats.ts frontend/lib/copy.ts
git commit -m "seats: mirror 20-min hold constant + copy"
```

---

## Task 3: Add `fetchSeatsClient()` helper + lost-seat copy

**Files:**
- Modify: `frontend/lib/holds.ts` (add export)
- Modify: `frontend/lib/copy.ts` (add notice under `seats.cart`)

- [ ] **Step 1: Add the browser-side seats fetch**

In `frontend/lib/holds.ts`, add the `Seat` type import at the top (after the existing `import { BACKEND_URL } from "./api";` line):

```ts
import type { Seat } from "./seats";
```

Then append this function at the end of the file:

```ts
/**
 * Browser-side poll of GET /api/seats for the live map. Returns the seat list
 * on success, or null on any network/parse error (caller keeps its last good
 * map and retries on the next tick). The /api/seats route returns the array
 * directly, matching the Seat shape.
 */
export async function fetchSeatsClient(): Promise<Seat[] | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/seats`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return null;
    return body as Seat[];
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add the lost-seat notice copy**

In `frontend/lib/copy.ts`, inside the `seats.cart` object, immediately after the `conflictNotice` line (line 18), add:

```ts
      lostSeatNotice: (label: string) =>
        `La butaca ${label} ya no está disponible — selecciónala de nuevo.`,
```

- [ ] **Step 3: Verify the frontend typechecks**

Run: `cd frontend && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/holds.ts frontend/lib/copy.ts
git commit -m "seats: add fetchSeatsClient + lost-seat notice copy"
```

---

## Task 4: Live polling + reconciliation in SeatPickerApp

**Files:**
- Modify: `frontend/app/components/SeatPickerApp.tsx`

This task adds: a `selectedRef` (to read the latest selection inside the poll without re-subscribing), a `reconcileSeats` callback, and a tab-visibility-aware polling effect. All side-effects stay **out of** state-updater functions (React StrictMode invokes updaters twice).

- [ ] **Step 1: Import the new helper**

In `frontend/app/components/SeatPickerApp.tsx`, change the holds import from:

```ts
import { releaseHolds, replaceHolds } from "@/lib/holds";
```

to:

```ts
import { fetchSeatsClient, releaseHolds, replaceHolds } from "@/lib/holds";
```

- [ ] **Step 2: Add the poll interval constant**

Directly below the existing `const SYNC_DEBOUNCE_MS = 350;` line, add:

```ts
const POLL_INTERVAL_MS = 5000;
```

- [ ] **Step 3: Add refs for the latest selection and poll sequence**

Immediately after the existing `const syncSeqRef = useRef(0); // last-write-wins guard against stale responses` line, add:

```ts
  const pollSeqRef = useRef(0); // last-write-wins guard for poll responses
  const selectedRef = useRef(selected); // latest selection for the poll callback
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
```

- [ ] **Step 4: Add the reconcile callback**

Add this `useCallback` after the `flushExpired` callback definition (before `showMaxNotice`):

```ts
  // Merge a fresh /api/seats snapshot into the grid. The user's own held seats
  // read back as "held" (the DTO can't tell whose hold it is), so we flip the
  // ones in our current selection back to "available" — exactly like the SSR
  // path in app/seats/page.tsx. Any selected seat that is now "taken" was paid
  // for by someone else after our hold lapsed: drop it, re-sync, and notify.
  const reconcileSeats = useCallback(
    (fresh: Seat[]) => {
      const sel = selectedRef.current;
      const freshById = new Map(fresh.map((s) => [s.id, s]));

      setSeats(
        fresh.map((s) =>
          sel.has(s.id) && s.status !== "taken"
            ? { ...s, status: "available" }
            : s,
        ),
      );

      const lost = [...sel].filter(
        (id) => freshById.get(id)?.status === "taken",
      );
      if (lost.length === 0) return;

      const lostSet = new Set(lost);
      const trimmed = new Set([...sel].filter((id) => !lostSet.has(id)));
      setSelected(trimmed);
      void syncHolds(trimmed);

      const labels = lost
        .map((id) => {
          const s = freshById.get(id);
          return s ? seatLabel(s.row, s.num) : id;
        })
        .join(", ");
      showConflictNotice(copy.seats.cart.lostSeatNotice(labels));
    },
    [syncHolds, showConflictNotice],
  );
```

- [ ] **Step 5: Add the polling effect**

Add this effect immediately after the `reconcileSeats` callback:

```ts
  // Live seat map: poll /api/seats every 5s while the tab is visible. Pause
  // when hidden; refetch immediately on return. Stale responses are dropped.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const seq = ++pollSeqRef.current;
      const fresh = await fetchSeatsClient();
      if (!fresh || seq !== pollSeqRef.current) return;
      reconcileSeats(fresh);
    };

    const start = () => {
      if (interval) return;
      void poll();
      interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reconcileSeats]);
```

- [ ] **Step 6: Verify typecheck and production build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: typecheck clean; build "✓ Compiled successfully" with all 10 routes (same as before).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/SeatPickerApp.tsx
git commit -m "seats: live 5s seat-map polling with lost-seat reconciliation"
```

---

## Task 5: Manual verification (no frontend test harness)

This project has no frontend test runner, so verify behavior manually against the running app (local `npm run dev` for both, or the deployed site). Use two different browser profiles / accounts.

- [ ] **Step 1: Longer hold** — Select a seat; confirm the cart countdown starts at ~20:00 (server-issued) and the empty-cart copy reads "Tienes 20 minutos cuando empieces."

- [ ] **Step 2: Live update across clients** — Account A selects seat C7. Within ~5s, Account B's open `/seats` map shows C7 as unavailable **without a manual refresh**.

- [ ] **Step 3: Seat frees live** — Let A's hold lapse (or release it). Within ~5s, B's map shows C7 available again.

- [ ] **Step 4: Lost-seat drop + notice** — With A holding C7 in its cart, finalize C7 from another account (`taken`). On A's next poll (~5s), C7 leaves A's cart and the notice "La butaca C·7 ya no está disponible — selecciónala de nuevo." appears.

- [ ] **Step 5: Tab-visibility pause** — On `/seats`, open the network panel, switch to another tab; confirm `/api/seats` requests stop. Return to the tab; confirm one immediate request, then resumed 5s polling.

- [ ] **Step 6 (optional): Backend constant in DB path** — Place a fresh hold and confirm in the DB (`SeatHold.expiresAt`) that it's ~20 minutes out, not 10.

---

## Task 6: Deploy

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Confirm deploys** — Railway redeploys the backend (new hold constant) and Vercel redeploys the frontend. After both go green, load `https://discocuatro.com/seats` and re-run Task 5 steps 1–2 against production.

---

## Self-Review

**Spec coverage:**
- Change A (10→20 min) → Tasks 1 (backend) + 2 (frontend mirror + copy). ✓
- Change B polling every 5s while visible → Task 4 Step 5. ✓
- Tab-aware pause + immediate refetch on return → Task 4 Step 5 (`onVisibility`/`start`). ✓
- Selection preserved through refresh (own holds read "held") → Task 4 Step 4 (flip to "available"). ✓
- Lost-seat (`taken`) drop + re-sync + notice → Task 4 Step 4. ✓
- Stale-response guard separate from `syncSeqRef` → Task 4 Step 3/5 (`pollSeqRef`). ✓
- Poll network blip keeps last good map → `fetchSeatsClient` returns null, `poll` returns early. ✓
- Testing/verification → Tasks 1 Step 2 (backend suite), 4 Step 6 (build), 5 (manual). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `fetchSeatsClient(): Promise<Seat[] | null>` defined in Task 3, consumed in Task 4. `reconcileSeats(fresh: Seat[])` and `lostSeatNotice(label: string)` names match across tasks. `Seat`, `seatLabel`, `copy`, `syncHolds`, `showConflictNotice`, `setSeats`, `setSelected` are all existing identifiers in `SeatPickerApp.tsx`/imports. ✓
