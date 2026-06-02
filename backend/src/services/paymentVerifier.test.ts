import { test, expect } from "vitest";
import { FakeVerifier, type VerifyInput } from "./paymentVerifier.js";

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
