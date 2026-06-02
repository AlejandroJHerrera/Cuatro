import { test, expect, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { prisma } from "../db.js";
import { checkoutVerifyRouter, type Mailer } from "./checkoutVerify.js";
import { FakeVerifier } from "../services/paymentVerifier.js";
import { makeUser, makeMovie, makeSeats, makeHold } from "../test/factories.js";

function buildApp(verifier: FakeVerifier, mailer: Mailer, userId: string, userEmail = "u@test.local", userName: string | null = "Test") {
  const app = express();
  app.use(session({ secret: "x", resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, email: userEmail, name: userName };
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use("/api/checkout", checkoutVerifyRouter({ verifier, mailer }));
  return app;
}

function fakeMailer(): Mailer {
  return {
    confirmation: vi.fn().mockResolvedValue({ id: "e1" }) as any,
    archive: vi.fn().mockResolvedValue({ id: "e2" }) as any,
    rejection: vi.fn().mockResolvedValue({ id: "e3" }) as any,
  };
}

async function seedScenario() {
  const user = await makeUser({ name: "Alex" });
  const movie = await makeMovie();
  const seats = await makeSeats(movie.id, ["A1", "A2"]);
  for (const s of seats) await makeHold(user.id, s.id);
  return { user, movie, seats };
}

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("approve → 200, tickets created, holds gone, confirmation + archive emails sent", async () => {
  const { user } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: true, txnId: "TXN-1", senderName: "Alex" });
  const app = buildApp(verifier, mailer, user.id);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe("approved");
  const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
  expect(tickets).toHaveLength(2);
  expect(tickets.every((t) => t.qrPayload?.startsWith("cuatro:1:"))).toBe(true);
  const holds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(holds).toHaveLength(0);
  expect((mailer.confirmation as any).mock.calls).toHaveLength(1);
  expect((mailer.archive as any).mock.calls).toHaveLength(1);
});

test("reject → 422, attempts++, archive email with screenshot", async () => {
  const { user } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "no coincide" });
  const app = buildApp(verifier, mailer, user.id);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(422);
  expect(res.body.reason).toBe("amount-mismatch");
  expect(res.body.attemptsLeft).toBe(2);
  const order = await prisma.order.findFirst({ where: { userId: user.id } });
  expect(order?.verificationAttempts).toBe(1);
  expect((mailer.archive as any).mock.calls[0][0].screenshot).toBeTruthy();
});

test("4th reject → 410 attempts-exhausted, holds released", async () => {
  const { user } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "x" });
  const app = buildApp(verifier, mailer, user.id);

  for (let i = 0; i < 3; i++) {
    await request(app).post("/api/checkout/verify").attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });
  }
  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(410);
  expect(res.body.status).toBe("attempts-exhausted");
  const holds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(holds).toHaveLength(0);
});

test("no holds → 410 holds-expired", async () => {
  const user = await makeUser();
  await makeMovie();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: true, txnId: "x", senderName: null });
  const app = buildApp(verifier, mailer, user.id, user.email, user.name);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(410);
  expect(res.body.status).toBe("holds-expired");
});
