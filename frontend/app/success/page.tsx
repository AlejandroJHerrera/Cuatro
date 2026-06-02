import type { Metadata } from "next";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { getMovie } from "@/lib/movie";
import { parseSeatId } from "@/lib/seats";
import {
  formatDateLine,
  formatVenueAddress,
} from "@/lib/format";
import { ErrorFallback } from "@/app/components/ErrorFallback";
import { TicketStub } from "@/app/components/TicketStub";
import { ResendEmailButton } from "@/app/components/ResendEmailButton";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: `${copy.success.eyebrow} — ${copy.brand.wordmark}`,
};

type SearchParams = Promise<{
  seats?: string;
  order?: string;
}>;

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser("/success");
  const params = await searchParams;
  const seatIds = parseSeats(params.seats);
  const orderId = parseOrderId(params.order);
  const movieRes = await getMovie();

  if (!movieRes.ok) return <ErrorFallback />;
  const { movie } = movieRes;

  if (seatIds.length === 0 || !orderId) {
    return <EmptySuccess />;
  }

  const dateLine = formatDateLine(movie.showtimeISO);
  const venueLine = formatVenueAddress(movie);
  const guestName = user.name;

  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        px-6 py-14
        sm:px-12 sm:py-20
        flex justify-center
      "
    >
      <div className="flex w-full max-w-[42rem] flex-col gap-14">
        {/* Welcome block */}
        <section className="flex flex-col gap-5">
          <span
            className="
              inline-flex items-center gap-3
              font-mono text-[0.6875rem] uppercase text-gold
              [font-variant-numeric:tabular-nums]
              after:block after:h-px after:max-w-[6em] after:flex-1
              after:bg-gold/45 after:content-['']
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.success.eyebrow}
          </span>
          <h1
            className="
              m-0 font-display font-light uppercase text-bulb
              text-[clamp(2.25rem,6vw,4rem)] leading-[0.95]
            "
            style={{ letterSpacing: "var(--tracking-marquee)" }}
          >
            {copy.success.heading}
          </h1>
          <p
            className="
              m-0 max-w-[40ch]
              font-body text-base leading-[1.6] text-bulb/80
            "
          >
            {copy.success.body}
          </p>
        </section>

        {/* Stubs */}
        <section
          aria-label="Boletos emitidos"
          className="flex flex-col gap-8 sm:gap-10"
        >
          {seatIds.map((id, i) => (
            <TicketStub
              key={id}
              seatId={id}
              orderId={orderId}
              guestName={guestName}
              dateLine={dateLine}
              venueLine={venueLine}
              index={i}
            />
          ))}
        </section>

        {/* Toolbar */}
        <div
          className="
            flex flex-col sm:flex-row sm:items-center
            gap-4 sm:gap-6
            pt-2
          "
        >
          <ResendEmailButton />
          <Link
            href="/my-tickets"
            className="
              inline-flex items-center
              font-mono text-[0.75rem] uppercase text-bulb
              border-b border-ash/35 pb-px self-start sm:self-auto
              transition-colors duration-200 ease-out-quart
              hover:text-gold hover:border-gold
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.success.myTicketsCta}
          </Link>
        </div>
      </div>
    </main>
  );
}

function EmptySuccess() {
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
          {copy.success.eyebrow}
        </span>
        <p
          className="
            m-0 font-display font-light uppercase text-bulb
            text-[clamp(1.5rem,4vw,2.25rem)] leading-[1.05]
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {copy.success.emptyHeading}
        </p>
        <p className="m-0 font-body text-sm text-bulb/70 max-w-[34ch]">
          {copy.success.emptyBody}
        </p>
        <Link
          href="/"
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
          {copy.success.emptyCta}
        </Link>
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

/** Sanitize the `order` query param to a short alphanumeric token. */
function parseOrderId(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 4 || cleaned.length > 16) return null;
  return cleaned;
}
