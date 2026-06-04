import { test, expect } from "vitest";
import { FakeVerifier, judgeReceipt, type VerifyInput, type ReceiptFields } from "./paymentVerifier.js";

const baseInput: VerifyInput = {
  imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  expected: {
    amountLps: 48,
    accountRef: "Banco Test 12345",
    orderCode: "ABC123",
    holdCreatedAt: new Date(),
  },
};

test("FakeVerifier returns canned approve verdict", async () => {
  const v = new FakeVerifier({ ok: true, txnId: "TXN-001", senderName: "Test" });
  expect(await v.verify(baseInput)).toEqual({ ok: true, txnId: "TXN-001", senderName: "Test" });
});

test("FakeVerifier returns canned reject verdict", async () => {
  const v = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "no coincide" });
  const result = await v.verify(baseInput);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("amount-mismatch");
});

test("FakeVerifier can throw to simulate timeout", async () => {
  const v = new FakeVerifier(new Error("timeout"));
  await expect(v.verify(baseInput)).rejects.toThrow("timeout");
});

// Canonical BAC "Notificación de transferencia" fixture (real format sample).
const bacFields: ReceiptFields = {
  isBankReceipt: true,
  destAccountNumber: "759407831",
  destName: "ALEJANDRO JOSE HERRERA CHINCHILLA",
  senderName: "JOSE JAVIER DIAZ CHINCHILLA",
  amount: 8210,
  currency: "L",
  dateTimeIso: "2026-05-22T11:12:00-06:00",
  reference: "412467270",
};

// A real Cuatro order: 2 seats × L1,000, paid to the configured account.
const order = { accountNumber: "100355841", amountLps: 2000 };
// "now" shortly after a matching receipt's timestamp.
const now = new Date("2026-05-22T13:00:00-06:00");

function approvable(): ReceiptFields {
  return { ...bacFields, destAccountNumber: "100355841", amount: 2000 };
}

test("judgeReceipt approves a matching, recent receipt", () => {
  const v = judgeReceipt(approvable(), order, now);
  expect(v).toEqual({ ok: true, txnId: "412467270", senderName: "JOSE JAVIER DIAZ CHINCHILLA" });
});

test("judgeReceipt rejects wrong destination account (the BAC sample)", () => {
  const v = judgeReceipt(bacFields, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("wrong-account");
});

test("judgeReceipt rejects amount mismatch", () => {
  const v = judgeReceipt({ ...approvable(), amount: 8210 }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("amount-mismatch");
});

test("judgeReceipt rejects a receipt older than 24h", () => {
  const later = new Date("2026-06-03T12:00:00-06:00");
  const v = judgeReceipt(approvable(), order, later);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("stale-receipt");
});

test("judgeReceipt rejects a future-dated receipt", () => {
  const earlier = new Date("2026-05-20T11:12:00-06:00");
  const v = judgeReceipt(approvable(), order, earlier);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("stale-receipt");
});

test("judgeReceipt rejects when reference is empty", () => {
  const v = judgeReceipt({ ...approvable(), reference: "  " }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("missing-txn-id");
});

test("judgeReceipt rejects a non-receipt image", () => {
  const v = judgeReceipt({ ...approvable(), isBankReceipt: false }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("not-a-receipt");
});

test("judgeReceipt rejects when currency marker is absent", () => {
  const v = judgeReceipt({ ...approvable(), currency: null }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("unreadable");
});

test("judgeReceipt normalizes account numbers with spaces/dashes", () => {
  const v = judgeReceipt({ ...approvable(), destAccountNumber: "1003-5584 1" }, order, now);
  expect(v.ok).toBe(true);
});

test("judgeReceipt rejects a receipt dated 15 minutes in the future", () => {
  const fifteenMinEarlier = new Date("2026-05-22T10:57:00-06:00"); // receipt is 11:12
  const v = judgeReceipt(approvable(), order, fifteenMinEarlier);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("stale-receipt");
});

test("judgeReceipt accepts a receipt within the future clock-skew window (9 min)", () => {
  const nineMinEarlier = new Date("2026-05-22T11:03:00-06:00"); // receipt is 11:12
  const v = judgeReceipt(approvable(), order, nineMinEarlier);
  expect(v.ok).toBe(true);
});
