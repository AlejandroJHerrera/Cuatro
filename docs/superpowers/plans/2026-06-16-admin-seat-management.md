# Admin Seat Management Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a dashboard to block seats (reserve/sell) with QR issuance + email delivery, release/void seats, toggle door check-in both ways, and see an admin-only revenue/breakdown panel.

**Architecture:** Reuse the existing `Order`/`Ticket` model — an admin block is an `Order` (`source = adminReserved|adminSold`, `totalLps = 0`) with `Ticket`s minted outside the payment flow, so seat-blocking, signed QR payloads, the door manifest, and scanning all work unchanged. Two schema columns (`Order.source`, `Order.recipientEmail`) and one new `OrderStatus.cancelled` value carry the new behavior.

**Tech Stack:** Express 5 + Prisma 5.22 + Postgres (backend), Next.js 15 + React 19 + Tailwind v4 (frontend), Vitest + supertest (tests).

**Spec:** [`docs/superpowers/specs/2026-06-16-admin-seat-management-design.md`](../specs/2026-06-16-admin-seat-management-design.md)

**Conventions to honor:**
- Seat `id` in the frontend equals the backend `Seat.label` (`"A1"`, `"C7"`). The block endpoint takes these labels.
- All new backend endpoints are gated by `requireRole("admin")`.
- Email sends are best-effort and **test-gated** (`env.NODE_ENV !== "test"`), mirroring the rate-limiter skip in [`checkoutVerify.ts`](../../../backend/src/routes/checkoutVerify.ts).
- Start the backend dev server with `unset ANTHROPIC_API_KEY && npm run dev` (the shell exports an empty key that shadows `.env`).
- Run backend tests from `backend/` with `npm test`.

---

## File Structure

**Backend:**
- Modify `backend/prisma/schema.prisma` — add `OrderSource` enum, `OrderStatus.cancelled`, `Order.source`, `Order.recipientEmail`.
- Create `backend/prisma/migrations/<timestamp>_admin_seat_management/migration.sql` — via `prisma migrate dev`.
- Modify `backend/src/services/orders.ts` — export `newOrderCode` for reuse.
- Create `backend/src/services/adminBlocks.ts` — `adminCreateBlock()` + `releaseOrder()` (pure DB, transactional).
- Create `backend/src/services/adminBlocks.test.ts` — service unit tests.
- Create `backend/src/services/orderEmail.ts` — `sendConfirmationForOrder(code, toEmail)` shared email helper.
- Modify `backend/src/routes/admin.ts` — add `/blocks`, `/orders/:code/release`, `/tickets/:id/checkin` (replaces `/manual-checkin`), `/orders/:code/resend-email`; extend `/door` with `source` + `revenue`.
- Modify `backend/src/routes/admin.test.ts` — add tests for the new routes.
- Modify `backend/src/routes/orders.ts` — refactor the customer resend route to use `sendConfirmationForOrder`.

**Frontend:**
- Create `frontend/lib/admin.ts` — browser client: `createBlock`, `releaseOrder`, `toggleCheckin`, `resendOrderEmail`, shared types.
- Create `frontend/app/admin/seats/page.tsx` — server entry, `requireRole(["admin"])`, seeds the seat map.
- Create `frontend/app/admin/seats/AdminSeatsClient.tsx` — seat multi-select + block form + QR result.
- Modify `frontend/app/admin/door/DoorClient.tsx` — revenue panel, two-way scan toggle, resend button.

**Docs:**
- Modify `HANDOFF.md` — document the new admin surface.

---

## Task 1: Schema — source, recipientEmail, cancelled

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_admin_seat_management/migration.sql` (generated)

- [ ] **Step 1: Add the enum + columns to the schema**

In `backend/prisma/schema.prisma`, add a new enum after the existing `OrderStatus` enum:

```prisma
enum OrderSource {
  customer
  adminReserved
  adminSold
}
```

Add `cancelled` to `OrderStatus`:

```prisma
enum OrderStatus {
  pending
  paid
  failed
  expired
  cancelled
}
```

In `model Order`, add two fields after `status`:

```prisma
  status          OrderStatus @default(pending)
  source          OrderSource @default(customer)
  recipientEmail  String?
```

- [ ] **Step 2: Generate + apply the migration**

Run (from `backend/`, with the dev DB up via `docker compose up -d`):

```bash
npx prisma migrate dev --name admin_seat_management
```

Expected: a new migration folder is created and applied; the Prisma client regenerates. The generated `migration.sql` should resemble:

```sql
CREATE TYPE "OrderSource" AS ENUM ('customer', 'adminReserved', 'adminSold');
ALTER TYPE "OrderStatus" ADD VALUE 'cancelled';
ALTER TABLE "Order" ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'customer',
ADD COLUMN "recipientEmail" TEXT;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (Prisma client now has `source`/`recipientEmail` and the `cancelled` status).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add Order.source, recipientEmail, OrderStatus.cancelled"
```

---

## Task 2: Export `newOrderCode` for reuse

**Files:**
- Modify: `backend/src/services/orders.ts:6`

- [ ] **Step 1: Export the generator**

In `backend/src/services/orders.ts`, change the `newOrderCode` declaration from module-private to exported:

```ts
const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newOrderCode = customAlphabet(ORDER_CODE_ALPHABET, 6);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/orders.ts
git commit -m "refactor(orders): export newOrderCode for reuse"
```

---

## Task 3: `adminCreateBlock` + `releaseOrder` services (TDD)

**Files:**
- Create: `backend/src/services/adminBlocks.ts`
- Test: `backend/src/services/adminBlocks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/adminBlocks.test.ts`:

```ts
import { test, expect } from "vitest";
import { prisma } from "../db.js";
import { adminCreateBlock, releaseOrder } from "./adminBlocks.js";
import { makeUser, makeMovie, makeSeats, makeHold } from "../test/factories.js";
import { verifyQrPayload } from "./qrSigning.js";

test("adminCreateBlock: creates a paid admin order + tickets with valid QR", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1", "A2"]);

  const { order, tickets } = await adminCreateBlock({
    adminId: admin.id,
    seatLabels: ["A1", "A2"],
    kind: "reserved",
    email: "guest@example.com",
    name: "Familia Díaz",
  });

  expect(order.status).toBe("paid");
  expect(order.source).toBe("adminReserved");
  expect(order.totalLps).toBe(0);
  expect(order.guestName).toBe("Familia Díaz");
  expect(order.recipientEmail).toBe("guest@example.com");
  expect(tickets).toHaveLength(2);
  for (const t of tickets) {
    expect(verifyQrPayload(t.qrPayload)).not.toBeNull();
  }
});

test("adminCreateBlock: kind=sold → source adminSold", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({
    adminId: admin.id, seatLabels: ["A1"], kind: "sold", email: "g@example.com",
  });
  expect(order.source).toBe("adminSold");
});

test("adminCreateBlock: blank name defaults to Reservado", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({
    adminId: admin.id, seatLabels: ["A1"], kind: "reserved", email: "g@example.com", name: "  ",
  });
  expect(order.guestName).toBe("Reservado");
});

test("adminCreateBlock: rejects a seat that already has a ticket (409 → conflict error)", async () => {
  const admin = await makeUser({ role: "admin" });
  const customer = await makeUser({ role: "customer" });
  const movie = await makeMovie();
  const [seat] = await makeSeats(movie.id, ["A1"]);
  const order = await prisma.order.create({
    data: { code: "EXIST1", userId: customer.id, status: "paid", totalLps: 1000, guestName: "x" },
  });
  await prisma.ticket.create({
    data: { orderId: order.id, seatId: seat!.id, userId: customer.id, qrPayload: "p:1" },
  });

  await expect(
    adminCreateBlock({ adminId: admin.id, seatLabels: ["A1"], kind: "reserved", email: "g@example.com" }),
  ).rejects.toThrow(/seat-conflict:A1/);
});

test("adminCreateBlock: rejects a seat with a live hold", async () => {
  const admin = await makeUser({ role: "admin" });
  const customer = await makeUser({ role: "customer" });
  const movie = await makeMovie();
  const [seat] = await makeSeats(movie.id, ["A1"]);
  await makeHold(customer.id, seat!.id);

  await expect(
    adminCreateBlock({ adminId: admin.id, seatLabels: ["A1"], kind: "reserved", email: "g@example.com" }),
  ).rejects.toThrow(/seat-conflict:A1/);
});

test("adminCreateBlock: unknown seat label → missing-seats error", async () => {
  const admin = await makeUser({ role: "admin" });
  await makeMovie();
  await expect(
    adminCreateBlock({ adminId: admin.id, seatLabels: ["Z9"], kind: "reserved", email: "g@example.com" }),
  ).rejects.toThrow(/missing-seats:Z9/);
});

test("releaseOrder: deletes tickets + receipt, frees seat, marks cancelled", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({
    adminId: admin.id, seatLabels: ["A1"], kind: "sold", email: "g@example.com",
  });

  const result = await releaseOrder(order.code);
  expect(result.ok).toBe(true);

  const after = await prisma.order.findUnique({ where: { code: order.code } });
  expect(after?.status).toBe("cancelled");
  expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
});

test("releaseOrder: idempotent on already-cancelled", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({
    adminId: admin.id, seatLabels: ["A1"], kind: "sold", email: "g@example.com",
  });
  await releaseOrder(order.code);
  const again = await releaseOrder(order.code);
  expect(again).toMatchObject({ ok: true, alreadyCancelled: true });
});

test("releaseOrder: unknown code → not ok", async () => {
  const result = await releaseOrder("NOPE00");
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- adminBlocks`
Expected: FAIL — `Cannot find module './adminBlocks.js'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/adminBlocks.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { newOrderCode } from "./orders.js";
import { signQrPayload } from "./qrSigning.js";

/**
 * Create an admin "block": an Order with source adminReserved|adminSold and
 * Tickets minted outside the payment flow. Each Ticket gets a signed QR so the
 * seat reads as taken on the public map and scans at the door, exactly like a
 * real sale. totalLps is 0 so admin blocks never count toward public revenue.
 *
 * Throws:
 *   - `missing-seats:<labels>` if any label doesn't exist.
 *   - `seat-conflict:<labels>` if any seat already has a ticket or a live hold.
 */
export async function adminCreateBlock(args: {
  adminId: string;
  seatLabels: string[];
  kind: "reserved" | "sold";
  email: string;
  name?: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const seats = await tx.seat.findMany({
        where: { label: { in: args.seatLabels } },
        include: { ticket: { select: { id: true } }, hold: { select: { expiresAt: true } } },
      });

      const found = new Set(seats.map((s) => s.label));
      const missing = args.seatLabels.filter((l) => !found.has(l));
      if (missing.length) throw new Error(`missing-seats:${missing.join(",")}`);

      const now = Date.now();
      const conflicts = seats
        .filter((s) => s.ticket || (s.hold && s.hold.expiresAt.getTime() > now))
        .map((s) => s.label);
      if (conflicts.length) throw new Error(`seat-conflict:${conflicts.join(",")}`);

      const source = args.kind === "sold" ? "adminSold" : "adminReserved";
      const guestName = args.name && args.name.trim() ? args.name.trim() : "Reservado";

      const order = await tx.order.create({
        data: {
          code: newOrderCode(),
          userId: args.adminId,
          status: "paid",
          source,
          totalLps: 0,
          guestName,
          recipientEmail: args.email,
        },
      });

      const tickets = await Promise.all(
        seats.map((s) =>
          tx.ticket.create({
            data: {
              orderId: order.id,
              seatId: s.id,
              userId: args.adminId,
              qrPayload: signQrPayload(order.code, s.label),
            },
            include: { seat: { select: { label: true } } },
          }),
        ),
      );

      return { order, tickets };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Void an order: delete its tickets + payment receipt (freeing the seats on the
 * public map) and mark the order cancelled (retained for audit). Works on admin
 * blocks and real paid orders (manual-refund path). Idempotent.
 */
export async function releaseOrder(
  code: string,
): Promise<{ ok: true; alreadyCancelled: boolean } | { ok: false; reason: "not-found" }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { code } });
    if (!order) return { ok: false as const, reason: "not-found" as const };
    if (order.status === "cancelled") return { ok: true as const, alreadyCancelled: true };

    await tx.ticket.deleteMany({ where: { orderId: order.id } });
    await tx.paymentReceipt.deleteMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });

    return { ok: true as const, alreadyCancelled: false };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- adminBlocks`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/adminBlocks.ts backend/src/services/adminBlocks.test.ts
git commit -m "feat(admin): adminCreateBlock + releaseOrder services"
```

---

## Task 4: Shared confirmation-email helper

**Files:**
- Create: `backend/src/services/orderEmail.ts`
- Modify: `backend/src/routes/orders.ts`

- [ ] **Step 1: Create the helper**

Create `backend/src/services/orderEmail.ts`:

```ts
import { prisma } from "../db.js";
import { env } from "../env.js";
import { renderQrPng } from "./qrRender.js";
import { sendOrderConfirmation } from "./email.js";

/**
 * Load a paid order's tickets and (re)send the customer confirmation email with
 * inline + attached per-seat QR PNGs to `toEmail`. Shared by the checkout flow's
 * resend, the customer resend route, and the admin routes. No-op if the order or
 * movie can't be found.
 */
export async function sendConfirmationForOrder(orderCode: string, toEmail: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
  });
  if (!order) return;
  const movie = await prisma.movie.findFirst();
  if (!movie) return;

  const qrAttachments = await Promise.all(
    order.tickets.map(async (t) => ({
      filename: `qr-${t.seat.label}.png`,
      content: await renderQrPng(t.qrPayload),
    })),
  );

  await sendOrderConfirmation({
    to: toEmail,
    props: {
      guestName: order.guestName,
      orderCode: order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: order.totalLps,
      seats: order.tickets.map((t) => ({
        label: t.seat.label,
        qrUrl: `${env.BACKEND_URL}/api/tickets/${order.code}/${encodeURIComponent(t.seat.label)}/qr.png`,
      })),
    },
    qrAttachments,
  });
}
```

- [ ] **Step 2: Refactor the customer resend route to use it**

Replace the body of `ordersRouter.post("/:code/resend-email", ...)` in `backend/src/routes/orders.ts` so it delegates to the helper (keeps the owner check + not-paid guard):

```ts
ordersRouter.post("/:code/resend-email", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string; name: string | null };
  const code = req.params.code as string;
  const order = await prisma.order.findUnique({ where: { code } });
  if (!order || order.userId !== user.id) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });

  await sendConfirmationForOrder(order.code, user.email);
  return res.json({ ok: true });
});
```

Update the imports at the top of `backend/src/routes/orders.ts`: remove the now-unused `env`, `renderQrPng`, and `sendOrderConfirmation` imports if nothing else uses them, and add:

```ts
import { sendConfirmationForOrder } from "../services/orderEmail.js";
```

(Keep `findOrCreatePendingOrder` and the `/pending` route untouched.)

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no unused-import or missing-symbol errors).

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderEmail.ts backend/src/routes/orders.ts
git commit -m "refactor(email): shared sendConfirmationForOrder helper"
```

---

## Task 5: Admin routes — blocks, release, checkin toggle, resend, door revenue (TDD)

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/routes/admin.test.ts` (the `appAs` helper and imports already exist; add the new imports at the top):

```ts
import { adminCreateBlock } from "../services/adminBlocks.js";
```

Then append these tests:

```ts
test("blocks: admin creates a reserved block → 201 with code + tickets", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1", "A2"]);
  const res = await request(appAs(admin))
    .post("/api/admin/blocks")
    .send({ seatLabels: ["A1", "A2"], kind: "reserved", email: "g@example.com", name: "Prensa" });
  expect(res.status).toBe(201);
  expect(res.body.code).toHaveLength(6);
  expect(res.body.tickets).toHaveLength(2);
});

test("blocks: missing email → 400", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const res = await request(appAs(admin))
    .post("/api/admin/blocks")
    .send({ seatLabels: ["A1"], kind: "reserved" });
  expect(res.status).toBe(400);
});

test("blocks: taken seat → 409 with conflicts", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  await adminCreateBlock({ adminId: admin.id, seatLabels: ["A1"], kind: "sold", email: "g@example.com" });
  const res = await request(appAs(admin))
    .post("/api/admin/blocks")
    .send({ seatLabels: ["A1"], kind: "reserved", email: "g@example.com" });
  expect(res.status).toBe(409);
  expect(res.body.conflicts).toEqual(["A1"]);
});

test("blocks: customer role → 403", async () => {
  const customer = await makeUser({ role: "customer" });
  const res = await request(appAs(customer))
    .post("/api/admin/blocks")
    .send({ seatLabels: ["A1"], kind: "reserved", email: "g@example.com" });
  expect(res.status).toBe(403);
});

test("release: frees the seat and is idempotent", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({ adminId: admin.id, seatLabels: ["A1"], kind: "sold", email: "g@example.com" });

  const res = await request(appAs(admin)).post(`/api/admin/orders/${order.code}/release`).send();
  expect(res.status).toBe(200);
  expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);

  const again = await request(appAs(admin)).post(`/api/admin/orders/${order.code}/release`).send();
  expect(again.body).toMatchObject({ ok: true, alreadyCancelled: true });
});

test("release: doorStaff role → 403", async () => {
  const staff = await makeUser({ role: "doorStaff" });
  const res = await request(appAs(staff)).post(`/api/admin/orders/ABC123/release`).send();
  expect(res.status).toBe(403);
});

test("checkin: toggles redeemedAt on then off", async () => {
  const { ticket } = await seedPaidTicket();
  const admin = await makeUser({ role: "admin" });

  const on = await request(appAs(admin)).post(`/api/admin/tickets/${ticket.id}/checkin`).send({ redeemed: true });
  expect(on.status).toBe(200);
  expect(on.body.redeemedAt).toBeTruthy();
  let row = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  expect(row?.redeemedAt).toBeTruthy();
  expect(row?.redeemedBy).toBe(admin.id);

  const off = await request(appAs(admin)).post(`/api/admin/tickets/${ticket.id}/checkin`).send({ redeemed: false });
  expect(off.status).toBe(200);
  expect(off.body.redeemedAt).toBeNull();
  row = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  expect(row?.redeemedAt).toBeNull();
  expect(row?.redeemedBy).toBeNull();
});

test("checkin: customer role → 403", async () => {
  const customer = await makeUser({ role: "customer" });
  const res = await request(appAs(customer)).post(`/api/admin/tickets/x/checkin`).send({ redeemed: true });
  expect(res.status).toBe(403);
});

test("door: revenue excludes admin blocks from publicRevenueLps", async () => {
  const admin = await makeUser({ role: "admin" });
  const customer = await makeUser({ role: "customer" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1", "A2", "A3"]);

  // A real public sale (A1) — counts toward revenue.
  const pub = await prisma.order.create({
    data: { code: "PUB001", userId: customer.id, status: "paid", source: "customer", totalLps: 1000, guestName: "Cliente" },
  });
  const [a1] = await prisma.seat.findMany({ where: { label: "A1" } });
  await prisma.ticket.create({ data: { orderId: pub.id, seatId: a1!.id, userId: customer.id, qrPayload: "pub:A1" } });

  // An admin comp (A2, A3) — must NOT count toward revenue.
  await adminCreateBlock({ adminId: admin.id, seatLabels: ["A2", "A3"], kind: "reserved", email: "g@example.com" });

  const res = await request(appAs(admin)).get("/api/admin/door");
  expect(res.status).toBe(200);
  expect(res.body.revenue.publicRevenueLps).toBe(1000);
  expect(res.body.revenue.soldPublicSeats).toBe(1);
  expect(res.body.revenue.compReservedSeats).toBe(2);
  expect(res.body.totals.sold).toBe(3);
});

test("door: doorStaff role → 403 (revenue is admin-only)", async () => {
  const staff = await makeUser({ role: "doorStaff" });
  const res = await request(appAs(staff)).get("/api/admin/door");
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- admin.test`
Expected: FAIL — new routes 404, `revenue` undefined.

- [ ] **Step 3: Implement the routes**

In `backend/src/routes/admin.ts`, update the imports:

```ts
import { Router } from "express";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireRole } from "../auth/requireRole.js";
import { verifyQrPayload } from "../services/qrSigning.js";
import { adminCreateBlock, releaseOrder } from "../services/adminBlocks.js";
import { sendConfirmationForOrder } from "../services/orderEmail.js";
```

Keep the existing `/scan` route unchanged. **Delete** the entire `adminRouter.post("/manual-checkin", ...)` route. **Replace** the `/door` handler and add the new routes:

```ts
adminRouter.post("/blocks", requireRole("admin"), async (req, res) => {
  const { seatLabels, kind, email, name } = req.body as {
    seatLabels?: string[]; kind?: string; email?: string; name?: string;
  };
  if (!Array.isArray(seatLabels) || seatLabels.length === 0) {
    return res.status(400).json({ error: "seatLabels required" });
  }
  if (kind !== "reserved" && kind !== "sold") {
    return res.status(400).json({ error: "kind must be reserved or sold" });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "valid email required" });
  }
  const admin = req.user as { id: string };
  try {
    const { order, tickets } = await adminCreateBlock({ adminId: admin.id, seatLabels, kind, email, name });
    if (env.NODE_ENV !== "test") {
      try {
        await sendConfirmationForOrder(order.code, email);
      } catch (e) {
        console.error(`[email] block ${order.code} failed:`, e);
      }
    }
    return res.status(201).json({
      code: order.code,
      tickets: tickets.map((t) => ({ seat: t.seat.label, qrPayload: t.qrPayload })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("seat-conflict:")) {
      return res.status(409).json({ error: "seat-conflict", conflicts: msg.slice("seat-conflict:".length).split(",") });
    }
    if (msg.startsWith("missing-seats:")) {
      return res.status(404).json({ error: "missing-seats", missing: msg.slice("missing-seats:".length).split(",") });
    }
    throw e;
  }
});

adminRouter.post("/orders/:code/release", requireRole("admin"), async (req, res) => {
  const result = await releaseOrder(req.params.code as string);
  if (!result.ok) return res.status(404).json({ error: "not-found" });
  return res.json({ ok: true, alreadyCancelled: result.alreadyCancelled });
});

adminRouter.post("/orders/:code/resend-email", requireRole("admin"), async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { code: req.params.code as string },
    include: { user: { select: { email: true } } },
  });
  if (!order) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });
  const to = order.recipientEmail ?? order.user.email;
  if (env.NODE_ENV !== "test") {
    try {
      await sendConfirmationForOrder(order.code, to);
    } catch (e) {
      console.error(`[email] admin-resend ${order.code} failed:`, e);
    }
  }
  return res.json({ ok: true });
});

adminRouter.post("/tickets/:id/checkin", requireRole("admin"), async (req, res) => {
  const { redeemed } = req.body as { redeemed?: boolean };
  const id = req.params.id as string;
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).json({ error: "not-found" });
  const admin = req.user as { id: string };

  if (redeemed) {
    if (ticket.redeemedAt) {
      return res.json({ ok: true, redeemedAt: ticket.redeemedAt.toISOString() });
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: { redeemedAt: new Date(), redeemedBy: admin.id },
    });
    return res.json({ ok: true, redeemedAt: updated.redeemedAt!.toISOString() });
  }

  await prisma.ticket.update({ where: { id }, data: { redeemedAt: null, redeemedBy: null } });
  return res.json({ ok: true, redeemedAt: null });
});

adminRouter.get("/door", requireRole("admin"), async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { status: "paid" },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const allTickets = orders.flatMap((o) => o.tickets);
  const scanned = allTickets.filter((t) => t.redeemedAt).length;
  const isPublic = (o: (typeof orders)[number]) => o.source === "customer";
  const soldPublicSeats = orders.filter(isPublic).reduce((n, o) => n + o.tickets.length, 0);
  const compReservedSeats = orders.filter((o) => !isPublic(o)).reduce((n, o) => n + o.tickets.length, 0);
  const publicRevenueLps = orders.filter(isPublic).reduce((n, o) => n + o.totalLps, 0);

  res.json({
    totals: { sold: allTickets.length, scanned, capacity: 121 },
    revenue: { publicRevenueLps, soldPublicSeats, compReservedSeats, scannedSeats: scanned, capacity: 121 },
    orders: orders.map((o) => ({
      code: o.code,
      guestName: o.guestName,
      totalLps: o.totalLps,
      source: o.source,
      tickets: o.tickets.map((t) => ({
        id: t.id,
        seat: t.seat.label,
        redeemedAt: t.redeemedAt?.toISOString() ?? null,
      })),
    })),
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- admin.test`
Expected: PASS (original 4 scan tests + the new tests).

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/admin.test.ts
git commit -m "feat(admin): blocks, release, checkin toggle, resend, door revenue"
```

---

## Task 6: Frontend admin client + types

**Files:**
- Create: `frontend/lib/admin.ts`

- [ ] **Step 1: Create the browser client**

Create `frontend/lib/admin.ts`:

```ts
import { BACKEND_URL } from "./api";

export type AdminTicket = { seat: string; qrPayload: string };

export type CreateBlockResult =
  | { ok: true; code: string; tickets: AdminTicket[] }
  | { ok: false; reason: "conflict" | "validation" | "auth" | "network"; conflicts?: string[]; message?: string };

export async function createBlock(args: {
  seatLabels: string[];
  kind: "reserved" | "sold";
  email: string;
  name?: string;
}): Promise<CreateBlockResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/blocks`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth" };
    const body = (await res.json().catch(() => ({}))) as {
      code?: string; tickets?: AdminTicket[]; error?: string; conflicts?: string[];
    };
    if (res.ok && body.code && body.tickets) return { ok: true, code: body.code, tickets: body.tickets };
    if (res.status === 409) return { ok: false, reason: "conflict", conflicts: body.conflicts ?? [] };
    if (res.status === 400) return { ok: false, reason: "validation", message: body.error };
    return { ok: false, reason: "network", message: body.error };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function releaseOrder(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/orders/${code}/release`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function toggleCheckin(ticketId: string, redeemed: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/tickets/${ticketId}/checkin`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redeemed }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resendOrderEmail(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/orders/${code}/resend-email`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run (from `frontend/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/admin.ts
git commit -m "feat(admin-ui): browser client for blocks/release/checkin/resend"
```

---

## Task 7: `/admin/seats` page + client

**Files:**
- Create: `frontend/app/admin/seats/page.tsx`
- Create: `frontend/app/admin/seats/AdminSeatsClient.tsx`

- [ ] **Step 1: Create the server entry**

Create `frontend/app/admin/seats/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth";
import { getSeats } from "@/lib/seats";
import { ErrorFallback } from "@/app/components/ErrorFallback";
import { AdminSeatsClient } from "./AdminSeatsClient";

export const dynamic = "force-dynamic";

export default async function AdminSeatsPage() {
  await requireRole(["admin"], "/admin/seats");
  const result = await getSeats();
  if (!result.ok) return <ErrorFallback />;
  return <AdminSeatsClient initialSeats={result.seats} />;
}
```

- [ ] **Step 2: Create the client**

Create `frontend/app/admin/seats/AdminSeatsClient.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import type { Seat } from "@/lib/seats";
import { fetchSeatsClient } from "@/lib/holds";
import { SeatGrid } from "@/app/components/SeatGrid";
import { QrBlock } from "@/app/components/QrBlock";
import { createBlock, type AdminTicket } from "@/lib/admin";

type Phase =
  | { kind: "select" }
  | { kind: "submitting" }
  | { kind: "done"; code: string; tickets: AdminTicket[] };

export function AdminSeatsClient({ initialSeats }: { initialSeats: Seat[] }) {
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<"reserved" | "sold">("reserved");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await fetchSeatsClient();
    if (fresh) setSeats(fresh);
  }, []);

  const onToggle = useCallback((seat: Seat) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }, []);

  async function onSubmit() {
    setError(null);
    if (selected.size === 0) return setError("Selecciona al menos una butaca.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Correo inválido.");
    setPhase({ kind: "submitting" });
    const res = await createBlock({ seatLabels: [...selected], kind, email, name });
    if (res.ok) {
      setPhase({ kind: "done", code: res.code, tickets: res.tickets });
      setSelected(new Set());
      setEmail("");
      setName("");
      await refresh();
      return;
    }
    setPhase({ kind: "select" });
    if (res.reason === "conflict") {
      setError(`Butacas ya ocupadas: ${(res.conflicts ?? []).join(", ")}.`);
      await refresh();
    } else if (res.reason === "validation") {
      setError(res.message ?? "Datos inválidos.");
    } else if (res.reason === "auth") {
      setError("No autorizado.");
    } else {
      setError("Error de red. Intenta de nuevo.");
    }
  }

  if (phase.kind === "done") {
    return (
      <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-6">
        <h1 className="font-display text-2xl uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
          Butacas bloqueadas · {phase.code}
        </h1>
        <p className="font-mono text-[0.75rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
          Se envió el correo con los códigos QR.
        </p>
        <div className="flex flex-wrap gap-6">
          {phase.tickets.map((t) => (
            <div key={t.seat} className="flex flex-col items-center gap-2">
              <QrBlock payload={t.qrPayload} size={160} />
              <span className="font-mono text-[0.6875rem] uppercase text-bulb/80">{t.seat}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPhase({ kind: "select" })}
          className="self-start inline-flex items-center min-h-12 px-5 font-mono text-[0.6875rem] uppercase border border-ash/35 text-bulb hover:border-gold hover:text-gold transition-colors"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          Bloquear más →
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-6">
      <h1 className="font-display text-2xl uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
        Gestión de butacas
      </h1>

      <SeatGrid seats={seats} selected={selected} onToggle={onToggle} />

      <div className="flex flex-col gap-4 max-w-md w-full mx-auto border-t border-ash/35 pt-4">
        <span className="font-mono text-[0.6875rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
          {selected.size} butaca(s): {[...selected].join(", ") || "—"}
        </span>

        <div className="flex gap-2">
          {(["reserved", "sold"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 min-h-11 font-mono text-[0.6875rem] uppercase border transition-colors ${
                kind === k ? "border-gold text-gold" : "border-ash/35 text-bulb hover:border-bulb"
              }`}
              style={{ letterSpacing: "var(--tracking-label)" }}
            >
              {k === "reserved" ? "Reservar" : "Vender"}
            </button>
          ))}
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo del destinatario (requerido)"
          className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre (opcional)"
          className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
        />

        {error && (
          <p className="font-mono text-[0.6875rem] uppercase text-red-400" style={{ letterSpacing: "var(--tracking-label)" }}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={phase.kind === "submitting"}
          className="min-h-12 px-5 font-mono text-[0.6875rem] uppercase bg-gold text-hall hover:opacity-90 transition-opacity disabled:opacity-60"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {phase.kind === "submitting" ? "Bloqueando…" : "Bloquear butacas + enviar QR →"}
        </button>
      </div>
    </main>
  );
}
```

> Note: `SeatGrid` only invokes `onToggle` for `available` seats (taken/held are non-interactive), so the admin can't accidentally select an occupied seat. Releasing an occupied seat is done from `/admin/door` (Task 8), which knows the order code.

- [ ] **Step 3: Verify typecheck + lint pass**

Run (from `frontend/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manually verify the page renders**

Start both servers (`unset ANTHROPIC_API_KEY && npm run dev` in `backend/`, `npm run dev` in `frontend/`), sign in as an admin, visit `/admin/seats`. Expected: the SALA 4 grid renders, seats are selectable, the form shows the selection count.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/seats
git commit -m "feat(admin-ui): /admin/seats block dashboard"
```

---

## Task 8: Enhance `/admin/door` — revenue panel, scan toggle, resend

**Files:**
- Modify: `frontend/app/admin/door/DoorClient.tsx`

- [ ] **Step 1: Replace DoorClient with the enhanced version**

Replace the contents of `frontend/app/admin/door/DoorClient.tsx`:

```tsx
"use client";
import { useState } from "react";
import { toggleCheckin, releaseOrder, resendOrderEmail } from "@/lib/admin";

export type Door = {
  totals: { sold: number; scanned: number; capacity: number };
  revenue: {
    publicRevenueLps: number;
    soldPublicSeats: number;
    compReservedSeats: number;
    scannedSeats: number;
    capacity: number;
  };
  orders: {
    code: string;
    guestName: string;
    totalLps: number;
    source: "customer" | "adminReserved" | "adminSold";
    tickets: { id: string; seat: string; redeemedAt: string | null }[];
  }[];
};

export function DoorClient({ initial }: { initial: Door }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");

  function setTicketRedeemed(ticketId: string, redeemed: boolean) {
    setData((d) => {
      const orders = d.orders.map((o) => ({
        ...o,
        tickets: o.tickets.map((t) =>
          t.id === ticketId ? { ...t, redeemedAt: redeemed ? new Date().toISOString() : null } : t,
        ),
      }));
      const scanned = orders.flatMap((o) => o.tickets).filter((t) => t.redeemedAt).length;
      return {
        ...d,
        totals: { ...d.totals, scanned },
        revenue: { ...d.revenue, scannedSeats: scanned },
        orders,
      };
    });
  }

  async function onToggle(ticketId: string, currentlyRedeemed: boolean) {
    const next = !currentlyRedeemed;
    setTicketRedeemed(ticketId, next); // optimistic
    const ok = await toggleCheckin(ticketId, next);
    if (!ok) setTicketRedeemed(ticketId, currentlyRedeemed); // revert
  }

  async function onRelease(code: string) {
    if (!confirm(`¿Liberar la orden ${code}? Sus butacas vuelven al mapa.`)) return;
    const ok = await releaseOrder(code);
    if (ok) setData((d) => ({ ...d, orders: d.orders.filter((o) => o.code !== code) }));
  }

  async function onResend(code: string) {
    await resendOrderEmail(code);
  }

  const ql = q.toLowerCase();
  const visible = data.orders.filter(
    (o) => !ql || o.code.toLowerCase().includes(ql) || o.guestName.toLowerCase().includes(ql),
  );

  const r = data.revenue;

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-4">
      <header
        className="font-mono text-[0.6875rem] uppercase text-bulb/65 flex flex-wrap gap-x-6 gap-y-1 border-b border-ash/35 pb-3"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <span>VENDIDAS · {data.totals.sold} / {data.totals.capacity}</span>
        <span>ESCANEADAS · {data.totals.scanned} / {data.totals.sold}</span>
      </header>

      {/* Admin-only revenue/breakdown panel. */}
      <section
        className="font-mono text-[0.6875rem] uppercase grid grid-cols-2 sm:grid-cols-4 gap-3 border border-gold/30 p-3"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <Metric label="Ingresos (público)" value={`L ${r.publicRevenueLps.toLocaleString("es-HN")}`} />
        <Metric label="Vendidas (público)" value={`${r.soldPublicSeats}`} />
        <Metric label="Reservadas/comp" value={`${r.compReservedSeats}`} />
        <Metric label="Escaneadas" value={`${r.scannedSeats} / ${data.totals.sold}`} />
      </section>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre u orden…"
        className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
      />

      <ul className="flex flex-col gap-3">
        {visible.length === 0 && (
          <li className="font-mono text-[0.6875rem] uppercase text-bulb/40 py-6" style={{ letterSpacing: "var(--tracking-label)" }}>
            Sin coincidencias.
          </li>
        )}
        {visible.map((o) => (
          <li key={o.code} className="border border-ash/35 p-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-lg uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
                {o.guestName}
                {o.source !== "customer" && (
                  <span className="ml-2 font-mono text-[0.5625rem] text-gold align-middle">
                    {o.source === "adminSold" ? "· VENDIDA (ADMIN)" : "· RESERVADA"}
                  </span>
                )}
              </span>
              <span className="font-mono text-[0.6875rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
                {o.code}
              </span>
            </div>

            <ul className="flex flex-col gap-1 font-mono text-[0.75rem] [font-variant-numeric:tabular-nums]">
              {o.tickets.map((t) => {
                const redeemed = !!t.redeemedAt;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${redeemed ? "bg-emerald-500" : "bg-bulb/35"}`} />
                      <span className="uppercase">{t.seat}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggle(t.id, redeemed)}
                      className="font-mono text-[0.6875rem] uppercase text-gold border-b border-gold/40 hover:border-gold transition-colors"
                      style={{ letterSpacing: "var(--tracking-label)" }}
                    >
                      {redeemed ? "DESMARCAR ✕" : "MARCAR ENTRADA ✓"}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-4 pt-1">
              <button
                type="button"
                onClick={() => onResend(o.code)}
                className="font-mono text-[0.625rem] uppercase text-bulb/70 border-b border-ash/35 hover:text-gold hover:border-gold transition-colors"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                Reenviar correo
              </button>
              <button
                type="button"
                onClick={() => onRelease(o.code)}
                className="font-mono text-[0.625rem] uppercase text-red-400/80 border-b border-red-400/30 hover:text-red-400 hover:border-red-400 transition-colors"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                Liberar butacas
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-bulb/55">{label}</span>
      <span className="text-base text-bulb [font-variant-numeric:tabular-nums]">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run (from `frontend/`): `npm run typecheck`
Expected: PASS. (The `Door` type now requires `revenue` + `source`, which the backend supplies as of Task 5; the `page.tsx` import of `Door` still resolves.)

- [ ] **Step 3: Manually verify**

As an admin, create a block on `/admin/seats`, then open `/admin/door`. Expected: the revenue panel shows the comp seat under "Reservadas/comp" (not revenue); the block's order row shows the "RESERVADA" tag; "MARCAR ENTRADA" toggles to "DESMARCAR" and back; "Liberar butacas" removes the order and frees the seat on `/admin/seats`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/door/DoorClient.tsx
git commit -m "feat(admin-ui): door revenue panel, scan toggle, resend + release"
```

---

## Task 9: Document the new admin surface

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Add a section**

In `HANDOFF.md`, under the admin surfaces area, add a short subsection documenting:
- `/admin/seats` (`requireRole(["admin"])`) — block (reserve/sell) seats, issues QR + emails recipient, shows QRs on success.
- New endpoints: `POST /api/admin/blocks`, `POST /api/admin/orders/:code/release`, `POST /api/admin/tickets/:id/checkin` (two-way; replaced `manual-checkin`), `POST /api/admin/orders/:code/resend-email`; `GET /api/admin/door` now returns `source` + a `revenue` block.
- Schema additions: `Order.source` (`customer|adminReserved|adminSold`), `Order.recipientEmail`, `OrderStatus.cancelled`.
- Note: admin blocks set `totalLps = 0` and are excluded from `revenue.publicRevenueLps`.

- [ ] **Step 2: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: document admin seat-management dashboard"
```

---

## Final verification

- [ ] Run `cd backend && npm test` → all tests pass (existing + new).
- [ ] Run `cd backend && npm run typecheck` → clean.
- [ ] Run `cd frontend && npm run typecheck` → clean.
- [ ] Manual end-to-end: admin blocks 2 seats → QRs render on `/admin/seats` + email attempted → seats read `taken` on public `/seats` → `/admin/door` revenue excludes them → scan toggle works both ways at `/admin/door` and via `/admin/scan` → release frees the seats.
