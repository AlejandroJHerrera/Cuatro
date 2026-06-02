import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const VERSION = "1";
const PREFIX = `cuatro:${VERSION}`;

function sign(input: string): string {
  return createHmac("sha256", Buffer.from(env.QR_SIGNING_SECRET, "hex"))
    .update(input)
    .digest("base64url");
}

export function signQrPayload(orderCode: string, seatId: string): string {
  const base = `${PREFIX}:${orderCode}:${seatId}`;
  return `${base}:${sign(base)}`;
}

export function verifyQrPayload(payload: string): { orderCode: string; seatId: string } | null {
  const parts = payload.split(":");
  if (parts.length !== 5) return null;
  const scheme = parts[0] as string;
  const version = parts[1] as string;
  const orderCode = parts[2] as string;
  const seatId = parts[3] as string;
  const sig = parts[4] as string;
  if (scheme !== "cuatro" || version !== VERSION) return null;

  const expected = sign(`${PREFIX}:${orderCode}:${seatId}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { orderCode, seatId };
}
