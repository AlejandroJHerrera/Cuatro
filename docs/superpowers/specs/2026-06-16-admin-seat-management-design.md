# Admin Seat Management Dashboard — Design

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with the project owner

## Problem

The app is live and selling tickets through the customer flow (seat map → bank
transfer → Claude verification → QR email → door scan). The owner needs an
**admin-only** surface to manage seats directly, without going through the
payment flow:

1. Select seats and take them off the market ("reserve" or "sell" — see below),
   issuing scannable QR codes for them.
2. Mark any QR as scanned **or** un-scanned (correct a mistaken door check-in).
3. See revenue and a sold/reserved/scanned breakdown — **admin role only**;
   door staff must not see this.

All three are admin-only (`UserRole.admin`).

## Key decisions (from brainstorming)

- **Reserved vs. sold is cosmetic.** Functionally identical: both block the seat
  on the public map and issue a QR. The label is recorded only for reporting.
- **A name is optional**, a generic default ("Reservado") is used when blank.
- **QR delivery is by email, and the email is required** to create a block.
- **Scan state is a two-way toggle** — admin can un-scan a mistaken check-in.
- **Revenue/breakdown is admin-only** — invisible to door staff.
- **Release/void is in scope** (the inverse of blocking). Without it a seat could
  be blocked but never returned to the market. Also serves as the manual-refund
  tool for the known "paid-but-lost-seat" race.

## Architectural approach

**Reuse the existing `Order` / `Ticket` model.** An admin block is just an
`Order` with `Ticket`s minted outside the payment flow. Because a seat reads as
`taken` the instant a `Ticket` exists (see
[`seatStatus.ts`](../../../backend/src/services/seatStatus.ts)), and `Ticket`s
already carry signed QR payloads and drive the door scanner, this gives us
seat-blocking, QR generation, the door manifest, and scanning **for free**.

Rejected alternative: a separate `AdminReservation` table. It would force the
seat map, scanner, and manifest to learn about a second source of truth — more
code, more bug surface, no benefit.

## Data model

Schema additions in
[`backend/prisma/schema.prisma`](../../../backend/prisma/schema.prisma), one
migration:

```prisma
enum OrderSource {
  customer
  adminReserved
  adminSold
}

// OrderStatus gains one value:
enum OrderStatus {
  pending
  paid
  failed
  expired
  cancelled   // released / voided order; its Tickets are deleted
}

model Order {
  // ...existing fields...
  source         OrderSource @default(customer)
  recipientEmail String?     // admin blocks only; customers use account email
}
```

- `Order.source` captures both "admin-created" **and** the cosmetic
  reserved/sold label in one field, and lets the revenue panel exclude admin
  blocks from real (public) revenue.
- `Order.recipientEmail` is the QR delivery target for admin blocks. Customer
  orders leave it null and continue to email the account user.
- `cancelled` is the terminal state of a released/voided order. Releasing
  deletes the order's `Ticket`s (and `PaymentReceipt`), so the seats return to
  the public map; the `Order` row is retained as `cancelled` for audit.

No change to `Ticket`, `Seat`, or `seatStatus` — blocking works exactly like a
real sale.

## Backend endpoints

All under `requireRole("admin")`.

### `POST /api/admin/blocks`
Body: `{ seatLabels: string[], kind: "reserved" | "sold", email: string, name?: string }`

New service `adminCreateBlock()` in a **serializable** transaction:
1. 400 if `email` missing/invalid or `seatLabels` empty.
2. Resolve labels → seats; 409 `{ conflicts: string[] }` if any seat already has
   a `Ticket` or a live `SeatHold`.
3. Create one `Order`: `source` = `adminReserved` | `adminSold` (from `kind`),
   `status` = `paid`, `recipientEmail` = `email`, `guestName` = `name` or
   `"Reservado"`, `userId` = the acting admin, `totalLps` = 0.
4. Mint a `Ticket` + signed QR payload (`signQrPayload(orderCode, seatLabel)`)
   per seat.
5. Send the existing confirmation email to `email` (best-effort `safeSend`; a
   mail failure never rolls back the block — same contract as checkout).

Returns `{ code, tickets: [{ seat, qrPayload }] }` so the UI can render QRs.

### `POST /api/admin/orders/:code/release`
Voids an order: deletes its `Ticket`s and `PaymentReceipt`, sets `status` =
`cancelled`. Seats return to the public map. Works on admin blocks **and** real
paid orders (manual-refund path). Idempotent: releasing an already-cancelled
order is a no-op 200. 404 on unknown code.

### `POST /api/admin/tickets/:id/checkin`
Body: `{ redeemed: boolean }`. Two-way toggle:
- `true` → stamp `redeemedAt = now`, `redeemedBy = admin.id` (no-op if already
  redeemed).
- `false` → clear `redeemedAt` and `redeemedBy`.

Replaces the one-way `POST /api/admin/manual-checkin` (removed — nothing else
calls it). The door-staff `POST /api/admin/scan` path is unchanged.

### `POST /api/admin/orders/:code/resend-email`
Admin resend for **any** order (customer or admin block). Reuses the existing
send path; for admin blocks the target is `recipientEmail`. 409 if the order is
not `paid`. (Distinct from the existing owner-checked
`POST /api/orders/:code/resend-email`, which stays for customers.)

### `GET /api/admin/door` (extended)
Adds `source` to each order and a `revenue` block:

```ts
revenue: {
  publicRevenueLps: number,   // sum of totalLps for source=customer, status=paid
  soldPublicSeats: number,    // tickets on source=customer paid orders
  compReservedSeats: number,  // tickets on source=adminReserved|adminSold orders
  scannedSeats: number,
  capacity: 121,
}
```

Already admin-only.

## Frontend

### New page `/admin/seats` (`requireRole(["admin"])`)
- Reuses `<SeatGrid>` in a multi-select mode (no hold timer, no cart total).
- Select seats → choose **Reservar** / **Vender** → enter **email (required)** +
  optional **name** → confirm.
- On success: shows the issued QRs on screen (reuses `<QrBlock>`) plus the order
  code; the email has also been sent.
- Selecting an already-taken seat surfaces the holding order (code + guest) with
  a **Release** button (calls `/release`).
- 409 conflict on submit lists the seats that were grabbed in the meantime.

### Enhanced `/admin/door`
- **Admin-only revenue/breakdown panel** at the top (public revenue, sold-public
  vs. comp/reserved seats, scanned, capacity).
- **Two-way scan toggle** per seat — clicking a checked-in seat un-scans it
  (calls `/checkin` with `redeemed:false`); optimistic UI.
- **Resend** button per order (calls the admin resend endpoint).
- Door staff at `/admin/scan` are untouched and never see revenue.

## Error handling

- Block on a taken/held seat → 409 with conflicting labels; UI re-fetches the map
  and shows which seats were lost.
- Missing/invalid email or empty selection → 400, inline form error.
- Mail send failure → block still succeeds; surfaced via `safeSend` logging and
  the Resend button as the escape hatch (same contract as checkout).
- Release/checkin on unknown code/ticket → 404.
- Any non-admin role on these endpoints → 403 (role gate).

## Testing (vitest, backend)

- `adminCreateBlock` creates an order + tickets + QR payloads; email attempted.
- Block rejects a seat that already has a ticket → 409 with the label.
- Block rejects a seat with a live hold → 409.
- Block requires a valid email → 400.
- Release deletes tickets + receipt, frees the seat, sets `cancelled`;
  idempotent on re-release.
- `checkin` toggles `redeemedAt` both directions; `redeemedBy` set on stamp,
  cleared on un-scan.
- `source` keeps admin blocks out of `revenue.publicRevenueLps` and
  `soldPublicSeats` (counted under `compReservedSeats`).
- Role gating: `doorStaff` and `customer` get 403 on every new endpoint.

## Out of scope

- A `/admin/staff` role-management UI (still Prisma Studio).
- Tigo Money / non-BAC receipt handling.
- Changing the customer purchase flow in any way.
