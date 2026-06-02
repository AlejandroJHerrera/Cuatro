/**
 * Browser-side hold client. The server component on /seats seeds the initial
 * state from GET /api/holds/me (with cookie forwarding); from there the picker
 * calls these to mutate.
 */
import { BACKEND_URL } from "./api";

export type HoldState = { seatIds: string[]; expiresAt: number };

export type ReplaceHoldsResult =
  | { ok: true; seatIds: string[]; expiresAt: number }
  | {
      ok: false;
      reason: "conflict" | "sold" | "missing" | "auth" | "network";
      conflictSeatIds?: string[];
      message?: string;
    };

export async function replaceHolds(seatIds: string[]): Promise<ReplaceHoldsResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/holds`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seatIds }),
    });
    if (res.status === 401) return { ok: false, reason: "auth" };
    const body = (await res.json().catch(() => ({}))) as {
      seatIds?: string[];
      expiresAt?: number;
      error?: string;
      conflictSeatIds?: string[];
      missingSeatIds?: string[];
    };
    if (res.ok && body.seatIds && typeof body.expiresAt === "number") {
      return { ok: true, seatIds: body.seatIds, expiresAt: body.expiresAt };
    }
    if (res.status === 409) {
      return {
        ok: false,
        reason: "conflict",
        conflictSeatIds: body.conflictSeatIds ?? [],
        message: body.error,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: "missing",
        conflictSeatIds: body.missingSeatIds ?? [],
        message: body.error,
      };
    }
    return { ok: false, reason: "network", message: body.error };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function releaseHolds(): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/holds`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // best-effort cleanup
  }
}
