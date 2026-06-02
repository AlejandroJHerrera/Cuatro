"use client";

import { copy } from "@/lib/copy";
import { formatMMSS, useCountdown } from "@/lib/useCountdown";

export function HoldTimer({ expiresAt }: { expiresAt: number }) {
  const { remainingMs, warn, announcement } = useCountdown(expiresAt);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className="font-mono text-[0.625rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.seats.cart.timerPrefix}
      </span>
      <span
        aria-hidden="true"
        className={`
          font-mono text-xl [font-variant-numeric:tabular-nums]
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
