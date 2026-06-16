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
