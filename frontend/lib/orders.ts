/**
 * Order history fetch — calls GET /api/my-tickets on the signed-in user's
 * behalf, forwarding the session cookie. Returns `{ ok: true, orders: [] }`
 * for a signed-in user with no purchases (renders the empty state).
 */
import { cookies } from "next/headers";

export type OrderStatus = "upcoming" | "past";

export type Order = {
  id: string;
  /** 6-char human-readable code. Use this for ?order= URLs and resend-email endpoints. */
  code: string;
  /** Movie title at time of purchase. */
  title: string;
  /** ISO showtime carrying the venue offset (see lib/format.ts). */
  showtimeISO: string;
  venueName: string;
  venueAddress: string;
  /** Seat labels in display order, e.g. ["C7", "C8", "C9"]. */
  seatIds: string[];
  /** Per-seat ticket data — same length as seatIds, includes signed QR payload. */
  tickets: { seat: string; qrPayload: string }[];
  /** "upcoming" before showtime, "past" after. Derived server-side. */
  status: OrderStatus;
  /** Total in whole Lempiras (matches schema's Order.totalLps). */
  totalLps: number;
};

const BACKEND_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export async function getMyOrders(): Promise<
  { ok: true; orders: Order[] } | { ok: false }
> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  try {
    const res = await fetch(`${BACKEND_URL}/api/my-tickets`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { orders: Order[] };
    return { ok: true, orders: data.orders };
  } catch {
    return { ok: false };
  }
}

/** "$36.00 LPS" — LPS prints to two decimals even though we store whole units. */
export function formatOrderTotal(totalLps: number): string {
  return `$${totalLps.toFixed(2)} LPS`;
}
