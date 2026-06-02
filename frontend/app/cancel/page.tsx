import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { parseSeatId } from "@/lib/seats";
import { CancelClient } from "@/app/components/CancelClient";

export const metadata: Metadata = {
  title: `${copy.cancel.eyebrow} — ${copy.brand.wordmark}`,
};

type SearchParams = Promise<{
  seats?: string;
  expires?: string;
}>;

/**
 * Stripe cancel landing.
 *
 * When backend phase 5 lands, Stripe Checkout's `cancel_url` should be
 *   ${FRONTEND_URL}/cancel?seats=A1,A2&expires=<ms>
 * so we can render the active-vs-expired state without an extra round-trip
 * to /api/holds.
 *
 * Today the route is reachable directly (no Stripe wired); without params
 * the page falls back to a generic active-cancel layout with no timer.
 */
export default async function CancelPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const seatIds = parseSeats(params.seats);
  const expiresAt = parseExpires(params.expires);

  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        px-6 py-14
        sm:px-12 sm:py-20
        flex justify-center
      "
    >
      <div className="flex w-full max-w-[36rem] flex-col gap-10">
        <CancelClient expiresAt={expiresAt} seatIds={seatIds} />
      </div>
    </main>
  );
}

/** Parse and validate the `seats` query param. Drops malformed/duplicate IDs. */
function parseSeats(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim().toUpperCase();
    if (!id || seen.has(id)) continue;
    if (!parseSeatId(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseExpires(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}
