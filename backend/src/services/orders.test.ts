import { test, expect } from "vitest";
import { prisma } from "../db.js";
import { makeUser, makeMovie, makeSeats, makeHold } from "../test/factories.js";
import { findOrCreatePendingOrder, finalizeOrderAsPaid } from "./orders.js";

async function setup() {
  const user = await makeUser();
  const movie = await makeMovie();
  const seats = await makeSeats(movie.id, ["A1", "A2"]);
  for (const seat of seats) await makeHold(user.id, seat.id);
  return { user, movie, seats };
}

test("creates a pending order when none exists", async () => {
  const { user } = await setup();
  const order = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: user.name ?? "X" });
  expect(order.status).toBe("pending");
  expect(order.code).toMatch(/^[A-Z2-9]{6}$/);
  expect(order.verificationAttempts).toBe(0);
});

test("reuses the existing pending order for the same user", async () => {
  const { user } = await setup();
  const a = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  const b = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  expect(b.id).toBe(a.id);
});

test("finalizeOrderAsPaid converts holds → tickets + sets status", async () => {
  const { user } = await setup();
  const order = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  const finalized = await finalizeOrderAsPaid({
    orderId: order.id,
    userId: user.id,
    qrPayloadFor: (seatLabel) => `cuatro:1:${order.code}:${seatLabel}:sig`,
    txnId: "TXN-1",
  });
  expect(finalized.tickets).toHaveLength(2);
  expect(finalized.tickets.every((t) => t.qrPayload?.startsWith("cuatro:1:"))).toBe(true);
  const dbHolds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(dbHolds).toHaveLength(0);
  const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
  expect(dbOrder?.status).toBe("paid");
  expect(dbOrder?.verifiedAt).toBeTruthy();
  const receipt = await prisma.paymentReceipt.findUnique({ where: { orderId: order.id } });
  expect(receipt?.txnId).toBe("TXN-1");
});

test("rejects duplicate txnId across orders", async () => {
  const { user } = await setup();
  const order1 = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  await finalizeOrderAsPaid({
    orderId: order1.id,
    userId: user.id,
    qrPayloadFor: (s) => `cuatro:1:${order1.code}:${s}:sig`,
    txnId: "TXN-DUP",
  });

  const user2 = await makeUser();
  const movie = (await prisma.movie.findFirst())!;
  const seats = await makeSeats(movie.id, ["B1", "B2"]);
  for (const seat of seats) await makeHold(user2.id, seat.id);
  const order2 = await findOrCreatePendingOrder({ userId: user2.id, totalLps: 24, guestName: "Y" });

  await expect(
    finalizeOrderAsPaid({
      orderId: order2.id,
      userId: user2.id,
      qrPayloadFor: (s) => `cuatro:1:${order2.code}:${s}:sig`,
      txnId: "TXN-DUP",
    }),
  ).rejects.toThrow(/duplicate/);
});
