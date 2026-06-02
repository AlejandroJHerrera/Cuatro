import { test, expect, describe } from "vitest";
import { signQrPayload, verifyQrPayload } from "./qrSigning.js";

describe("qrSigning", () => {
  test("round-trips a valid payload", () => {
    const payload = signQrPayload("ABC123", "A7");
    expect(payload.startsWith("cuatro:1:ABC123:A7:")).toBe(true);
    expect(verifyQrPayload(payload)).toEqual({ orderCode: "ABC123", seatId: "A7" });
  });

  test("rejects a tampered signature", () => {
    const payload = signQrPayload("ABC123", "A7");
    const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(verifyQrPayload(tampered)).toBeNull();
  });

  test("rejects a tampered seat", () => {
    const payload = signQrPayload("ABC123", "A7");
    const parts = payload.split(":");
    parts[3] = "A8";
    expect(verifyQrPayload(parts.join(":"))).toBeNull();
  });

  test("rejects wrong version", () => {
    expect(verifyQrPayload("cuatro:2:ABC123:A7:xxx")).toBeNull();
  });

  test("rejects malformed", () => {
    expect(verifyQrPayload("not-a-payload")).toBeNull();
    expect(verifyQrPayload("cuatro:1:ABC123:A7")).toBeNull();
  });
});
