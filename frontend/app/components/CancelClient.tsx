"use client";

import Link from "next/link";
import { copy } from "@/lib/copy";
import { formatMMSS, useCountdown } from "@/lib/useCountdown";
import { parseSeatId, seatLabel } from "@/lib/seats";

type Props = {
  expiresAt: number | null;
  seatIds: string[];
};

/**
 * Client island for /cancel. Holds the live timer state and swaps the page
 * body between two variants without re-fetching:
 *   - active hold  → "your reservation still stands" + retry + modify
 *   - expired hold → "your reservation lapsed" + single CTA back to /seats
 *
 * No redirect on expiry — the user landed here from Stripe explicitly, so
 * bouncing them away would be aggressive. The state just relaxes into the
 * expired variant.
 */
export function CancelClient({ expiresAt, seatIds }: Props) {
  const { remainingMs, warn, expired, announcement } = useCountdown(expiresAt);
  // Treat "no expiry param" as the active branch with no timer — the user
  // still has time but we just don't know how much (e.g. direct visit).
  const showExpired = expiresAt != null && expired;
  const checkoutHref = buildCheckoutHref(seatIds, expiresAt);

  return (
    <>
      <header className="flex flex-col gap-5">
        <span
          className="
            inline-flex items-center gap-3
            font-mono text-[0.6875rem] uppercase text-bulb/55
            after:block after:h-px after:max-w-[6em] after:flex-1
            after:bg-ash/45 after:content-['']
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.cancel.eyebrow}
        </span>
        <h1
          className="
            m-0 font-display font-light uppercase text-bulb
            text-[clamp(2rem,5.5vw,3.5rem)] leading-[0.95]
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {showExpired ? copy.cancel.expiredHeading : copy.cancel.activeHeading}
        </h1>
        <p className="m-0 max-w-[42ch] font-body text-base leading-[1.6] text-bulb/80">
          {showExpired ? copy.cancel.expiredBody : copy.cancel.activeBody}
        </p>
      </header>

      {/* Seat readout — present whenever we have seat IDs to print. */}
      {seatIds.length > 0 && (
        <SeatReadout seatIds={seatIds} dimmed={showExpired} />
      )}

      {/* Timer — only meaningful in the active branch with a known expiry. */}
      {!showExpired && expiresAt != null && (
        <TimerLine
          remainingMs={remainingMs}
          warn={warn}
          announcement={announcement}
        />
      )}

      {/* CTAs */}
      {showExpired ? (
        <Link
          href="/seats"
          className="
            inline-flex items-center justify-center
            min-h-14 self-start
            px-8 py-3
            font-body font-medium text-base uppercase
            bg-gold text-hall border border-gold
            transition-[background,box-shadow] duration-200 ease-out-quart
            hover:bg-gold-deep hover:shadow-[0_0_0_5px_var(--color-gold-glow)]
            focus-visible:outline-none
            focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.cancel.pickAgainCta}
        </Link>
      ) : (
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <Link
            href={checkoutHref}
            className="
              inline-flex items-center justify-center
              min-h-14 px-8 py-3
              font-body font-medium text-base uppercase
              bg-gold text-hall border border-gold
              transition-[background,box-shadow] duration-200 ease-out-quart
              hover:bg-gold-deep hover:shadow-[0_0_0_5px_var(--color-gold-glow)]
              focus-visible:outline-none
              focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.cancel.retryCta}
          </Link>
          <Link
            href="/seats"
            className="
              inline-flex items-center
              font-mono text-[0.6875rem] uppercase text-bulb
              border-b border-ash/35 pb-px
              transition-colors duration-200 ease-out-quart
              hover:text-gold hover:border-gold
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.cancel.changeCta}
          </Link>
        </div>
      )}
    </>
  );
}

function SeatReadout({
  seatIds,
  dimmed,
}: {
  seatIds: string[];
  dimmed: boolean;
}) {
  const labels = seatIds
    .map((id) => {
      const parsed = parseSeatId(id);
      return parsed ? seatLabel(parsed.row, parsed.num) : id;
    })
    .join("   ");
  return (
    <dl
      className={`
        grid grid-cols-[auto_1fr] items-baseline gap-x-5
        border-y border-ash/25 py-4
        font-mono text-[0.6875rem] uppercase
        [font-variant-numeric:tabular-nums]
        transition-opacity duration-200 ease-out-quart
        ${dimmed ? "opacity-55" : ""}
      `}
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      <dt className="text-bulb/55">{copy.cancel.seatsLabel}</dt>
      <dd className="m-0 text-bulb">{labels}</dd>
    </dl>
  );
}

function TimerLine({
  remainingMs,
  warn,
  announcement,
}: {
  remainingMs: number;
  warn: boolean;
  announcement: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ash/20 pb-3">
      <span
        className="font-mono text-[0.625rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.cancel.timerPrefix}
      </span>
      <span
        aria-hidden="true"
        className={`
          font-mono text-base [font-variant-numeric:tabular-nums]
          transition-colors duration-500 ease-out-quart
          ${warn ? "text-gold" : "text-bulb/95"}
        `}
        style={{ letterSpacing: "0.03em" }}
      >
        {formatMMSS(remainingMs)}
      </span>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function buildCheckoutHref(seatIds: string[], expiresAt: number | null): string {
  if (seatIds.length === 0) return "/seats";
  const params = new URLSearchParams({ seats: seatIds.join(",") });
  if (expiresAt != null) params.set("expires", String(expiresAt));
  return `/checkout?${params.toString()}`;
}
