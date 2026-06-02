import type { Metadata } from "next";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { getMovie } from "@/lib/movie";
import {
  formatPriceLPS,
  formatTotalLPS,
  parseSeatId,
  seatLabel,
} from "@/lib/seats";
import {
  formatDateLine,
  formatVenueAddress,
} from "@/lib/format";
import { ErrorFallback } from "@/app/components/ErrorFallback";
import { CheckoutClient } from "@/app/components/CheckoutClient";
import { requireUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { PRICE_PER_SEAT_LPS } from "@/lib/seats";

const SERVER_API = process.env.API_URL ?? "http://localhost:4000";

export const metadata: Metadata = {
  title: `${copy.checkout.eyebrow} — ${copy.brand.wordmark}`,
};

type SearchParams = Promise<{
  seats?: string;
  expires?: string;
}>;

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser("/checkout");
  const params = await searchParams;
  const seatIds = parseSeats(params.seats);
  const expiresAt = parseExpires(params.expires);
  const movieRes = await getMovie();

  if (!movieRes.ok) return <ErrorFallback />;
  const { movie } = movieRes;

  if (seatIds.length === 0) {
    return <EmptyOrder />;
  }

  const dateLine = formatDateLine(movie.showtimeISO);
  const venueLine = formatVenueAddress(movie);
  const total = formatTotalLPS(seatIds.length);
  const perSeat = formatPriceLPS();

  const totalLpsNum = seatIds.length * PRICE_PER_SEAT_LPS;
  const cookieHeader = (await cookies()).toString();
  const orderRes = await fetch(`${SERVER_API}/api/orders/pending`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ totalLps: totalLpsNum, guestName: user.name ?? user.email }),
    cache: "no-store",
  });
  if (!orderRes.ok) return <ErrorFallback />;
  const { code: orderCode } = (await orderRes.json()) as { code: string };
  const bankRef = process.env.NEXT_PUBLIC_BANK_ACCOUNT_REF ?? "Cuenta pendiente";

  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        px-6 py-10
        sm:px-12 sm:py-16
        flex justify-center
      "
    >
      <div className="flex w-full max-w-[32rem] flex-col gap-10">
        {/* Eyebrow */}
        <span
          className="
            inline-flex items-center gap-3
            font-mono text-[0.6875rem] uppercase text-bulb/55
            after:block after:h-px after:max-w-[6em] after:flex-1
            after:bg-ash/45 after:content-['']
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.eyebrow}
        </span>

        {/* Marquee block */}
        <section className="flex flex-col gap-2">
          <Link
            href="/"
            className="
              w-fit font-display font-light uppercase text-bulb
              text-[clamp(2rem,5vw,3rem)] leading-[0.95]
              transition-colors duration-200 ease-out-quart
              hover:text-gold
            "
            style={{ letterSpacing: "var(--tracking-marquee)" }}
          >
            {movie.title.toUpperCase()}
          </Link>
          <p
            className="
              m-0 font-mono text-[0.8125rem] uppercase text-bulb/85
              [font-variant-numeric:tabular-nums]
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {dateLine}
          </p>
          <p
            className="
              m-0 font-mono text-[0.6875rem] uppercase text-bulb/65
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {venueLine}
          </p>
        </section>

        {/* Seat table */}
        <SeatsTable seatIds={seatIds} perSeat={perSeat} total={total} />

        {/* Client island: timer + pay button. */}
        <CheckoutClient
          expiresAt={expiresAt}
          seatCount={seatIds.length}
          seatIds={seatIds}
          totalLps={totalLpsNum}
          orderCode={orderCode}
          bankRef={bankRef}
        />

        {/* Back link */}
        <Link
          href="/seats"
          className="
            self-start font-mono text-[0.6875rem] uppercase text-bulb/65
            border-b border-ash/35 pb-px
            transition-colors duration-200 ease-out-quart
            hover:text-gold hover:border-gold
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.backLink}
        </Link>
      </div>
    </main>
  );
}

function SeatsTable({
  seatIds,
  perSeat,
  total,
}: {
  seatIds: string[];
  perSeat: string;
  total: string;
}) {
  return (
    <section aria-labelledby="seats-table-label">
      <h2 id="seats-table-label" className="sr-only">
        {copy.checkout.eyebrow}
      </h2>
      <div
        className="
          grid grid-cols-[1fr_auto] items-baseline gap-y-3 gap-x-6
          py-3
          border-y border-ash/35
          font-mono text-[0.6875rem] uppercase text-bulb/55
          [font-variant-numeric:tabular-nums]
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <span>{copy.checkout.tableSeats}</span>
        <span className="text-right">{copy.checkout.tablePrice}</span>
      </div>
      <ul className="list-none m-0 p-0">
        {seatIds.map((id) => {
          const parsed = parseSeatId(id);
          const label = parsed ? seatLabel(parsed.row, parsed.num) : id;
          return (
            <li
              key={id}
              className="
                grid grid-cols-[1fr_auto] items-baseline gap-x-6
                py-3
                border-b border-ash/20
                font-display text-base uppercase text-bulb
                [font-variant-numeric:tabular-nums]
              "
              style={{ letterSpacing: "0.04em" }}
            >
              <span>{label}</span>
              <span
                className="text-right font-mono text-sm text-bulb/85"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                {perSeat}
              </span>
            </li>
          );
        })}
      </ul>
      <div
        className="
          grid grid-cols-[1fr_auto] items-baseline gap-x-6
          py-4
          font-mono text-sm uppercase text-bulb
          [font-variant-numeric:tabular-nums]
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <span className="text-bulb/65 text-[0.6875rem]">
          {copy.checkout.totalLabel}
        </span>
        <span className="text-right">{total}</span>
      </div>
    </section>
  );
}

function EmptyOrder() {
  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        grid place-items-center px-6
      "
    >
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <span
          className="font-mono text-[0.6875rem] uppercase text-bulb/55"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.eyebrow}
        </span>
        <p
          className="
            m-0 font-display font-light uppercase text-bulb
            text-[clamp(1.5rem,4vw,2.25rem)]
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {copy.checkout.emptyHeading}
        </p>
        <Link
          href="/seats"
          className="
            inline-flex items-center justify-center
            min-h-12 px-7 py-3
            font-body font-medium text-sm uppercase
            border border-gold text-bulb
            transition-colors duration-200 ease-out-quart
            hover:bg-gold hover:text-hall
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.emptyCta}
        </Link>
      </div>
    </main>
  );
}

/** Parse and validate the `seats` query param. Drops malformed IDs. */
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

/** Parse the `expires` query param. Returns null if missing or invalid. */
function parseExpires(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}
