import { test, expect } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../db.js";
import { adminRouter } from "./admin.js";
import { makeUser, makeMovie, makeSeats } from "../test/factories.js";
import { signQrPayload } from "../services/qrSigning.js";
import { adminCreateBlock } from "../services/adminBlocks.js";

function appAs(user: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => !!user;
    next();
  });
  app.use("/api/admin", adminRouter);
  return app;
}

async function seedPaidTicket() {
  const customer = await makeUser({ role: "customer" });
  const staff = await makeUser({ role: "doorStaff" });
  const movie = await makeMovie();
  const [seat] = await makeSeats(movie.id, ["A1"]);
  const order = await prisma.order.create({
    data: { code: "ABC123", userId: customer.id, status: "paid", totalLps: 12, guestName: "Alex" },
  });
  const payload = signQrPayload("ABC123", "A1");
  const ticket = await prisma.ticket.create({
    data: { orderId: order.id, seatId: seat!.id, userId: customer.id, qrPayload: payload },
  });
  return { customer, staff, ticket, payload };
}

test("scan: valid payload → ok with guestName + seat", async () => {
  const { staff, payload } = await seedPaidTicket();
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, seat: "A1", guestName: "Alex", alreadyUsed: false });
});

test("scan: second time → alreadyUsed with timestamp", async () => {
  const { staff, payload } = await seedPaidTicket();
  await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  expect(res.status).toBe(200);
  expect(res.body.alreadyUsed).toBe(true);
  expect(res.body.redeemedAt).toBeTruthy();
});

test("scan: tampered signature → 400 invalid", async () => {
  const { staff, payload } = await seedPaidTicket();
  const bad = payload.slice(0, -2) + "ZZ";
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload: bad });
  expect(res.status).toBe(400);
});

test("scan: customer role → 403", async () => {
  const customer = await makeUser({ role: "customer" });
  const res = await request(appAs(customer)).post("/api/admin/scan").send({ payload: "x" });
  expect(res.status).toBe(403);
});

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

  const pub = await prisma.order.create({
    data: { code: "PUB001", userId: customer.id, status: "paid", source: "customer", totalLps: 1000, guestName: "Cliente" },
  });
  const [a1] = await prisma.seat.findMany({ where: { label: "A1" } });
  await prisma.ticket.create({ data: { orderId: pub.id, seatId: a1!.id, userId: customer.id, qrPayload: "pub:A1" } });

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

test("checkin: missing redeemed field → 400", async () => {
  const { ticket } = await seedPaidTicket();
  const admin = await makeUser({ role: "admin" });
  const res = await request(appAs(admin)).post(`/api/admin/tickets/${ticket.id}/checkin`).send({});
  expect(res.status).toBe(400);
});

test("resend-email: admin resends a paid order → 200", async () => {
  const admin = await makeUser({ role: "admin" });
  const movie = await makeMovie();
  await makeSeats(movie.id, ["A1"]);
  const { order } = await adminCreateBlock({ adminId: admin.id, seatLabels: ["A1"], kind: "reserved", email: "g@example.com" });
  const res = await request(appAs(admin)).post(`/api/admin/orders/${order.code}/resend-email`).send();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true });
});

test("resend-email: non-paid order → 409", async () => {
  const admin = await makeUser({ role: "admin" });
  const customer = await makeUser({ role: "customer" });
  await prisma.order.create({
    data: { code: "PEND01", userId: customer.id, status: "pending", totalLps: 1000, guestName: "x" },
  });
  const res = await request(appAs(admin)).post(`/api/admin/orders/PEND01/resend-email`).send();
  expect(res.status).toBe(409);
});

test("resend-email: unknown code → 404", async () => {
  const admin = await makeUser({ role: "admin" });
  const res = await request(appAs(admin)).post(`/api/admin/orders/NOPE00/resend-email`).send();
  expect(res.status).toBe(404);
});

test("resend-email: customer role → 403", async () => {
  const customer = await makeUser({ role: "customer" });
  const res = await request(appAs(customer)).post(`/api/admin/orders/ABC123/resend-email`).send();
  expect(res.status).toBe(403);
});
