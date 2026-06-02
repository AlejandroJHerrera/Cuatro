import Link from "next/link";
import { copy } from "@/lib/copy";
import type { Order } from "@/lib/orders";
import { formatOrderTotal } from "@/lib/orders";
import { formatDateLine, formatVenueAddress } from "@/lib/format";
import { parseSeatId, seatLabel } from "@/lib/seats";
import { ResendEmailButton } from "./ResendEmailButton";

/**
 * One row per purchase. Ash frame (not gold — the gold is reserved for the
 * issued stubs on /success). Past orders dim to ~55% opacity and disable
 * the resend CTA — once the function is over, re-emailing isn't useful.
 */
export function OrderCard({ order }: { order: Order }) {
  const isPast = order.status === "past";
  const dateLine = formatDateLine(order.showtimeISO);
  const venueLine = formatVenueAddress(order);
  const total = formatOrderTotal(order.totalLps);
  const seatLabels = order.seatIds
    .map((id) => {
      const parsed = parseSeatId(id);
      return parsed ? seatLabel(parsed.row, parsed.num) : id;
    })
    .join("   ");
  const reopenHref =
    `/success?seats=${encodeURIComponent(order.seatIds.join(","))}` +
    `&order=${encodeURIComponent(order.code)}`;

  return (
    <article
      className={`
        relative flex flex-col gap-6
        border border-ash/35
        bg-curtain/40
        px-7 py-8 sm:px-9 sm:py-10
        transition-colors duration-200 ease-out-quart
        ${isPast ? "opacity-55 hover:opacity-75" : "hover:bg-curtain/60"}
      `}
    >
      {isPast && (
        <span
          className="
            absolute right-7 top-7 sm:right-9 sm:top-10
            font-mono text-[0.625rem] uppercase text-bulb/55
            [font-variant-numeric:tabular-nums]
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.myTickets.pastTag}
        </span>
      )}

      {/* Marquee block */}
      <header className="flex flex-col gap-2">
        <h2
          className="
            m-0 font-display font-light uppercase text-bulb
            text-[clamp(1.5rem,3.5vw,2.25rem)] leading-[0.95]
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {order.title.toUpperCase()}
        </h2>
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
          className="m-0 font-mono text-[0.6875rem] uppercase text-bulb/65"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {venueLine}
        </p>
      </header>

      {/* Operational stamps */}
      <dl
        className="
          grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5
          border-t border-ash/25 pt-5
          font-mono text-[0.6875rem] uppercase
          [font-variant-numeric:tabular-nums]
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <dt className="text-bulb/55">{copy.myTickets.cardSeatsLabel}</dt>
        <dd className="m-0 text-bulb">{seatLabels}</dd>

        <dt className="text-bulb/55">{copy.myTickets.cardOrderLabel}</dt>
        <dd className="m-0 text-bulb">{order.code}</dd>

        <dt className="text-bulb/55">{copy.myTickets.cardTotalLabel}</dt>
        <dd className="m-0 text-bulb">{total}</dd>
      </dl>

      {/* Per-card toolbar */}
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 pt-1">
        {!isPast && (
          <ResendEmailButton orderCode={order.code} variant="inline" />
        )}
        <Link
          href={reopenHref}
          className="
            inline-flex items-center
            font-mono text-[0.6875rem] uppercase text-bulb/85
            border-b border-ash/35 pb-px
            transition-colors duration-200 ease-out-quart
            hover:text-gold hover:border-gold
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.myTickets.cardViewTickets}
        </Link>
      </div>
    </article>
  );
}
