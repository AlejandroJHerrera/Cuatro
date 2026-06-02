import { test, expect } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../db.js";
import { adminRouter } from "./admin.js";
import { makeUser, makeMovie, makeSeats } from "../test/factories.js";
import { signQrPayload } from "../services/qrSigning.js";

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
