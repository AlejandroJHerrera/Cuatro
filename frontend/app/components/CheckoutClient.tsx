"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";
import {
  formatMMSS,
  useCountdown,
} from "@/lib/useCountdown";
import { formatTotalLPS } from "@/lib/seats";
import { BACKEND_URL } from "@/lib/api";

type Props = {
  expiresAt: number | null;
  seatCount: number;
  totalLabel: string;
  seatIds: string[];
};

/**
 * Client-side overlay for /checkout: ticks the hold timer, locks the page
 * if it expires, and hands off to Stripe Checkout on Pay.
 */
export function CheckoutClient({ expiresAt, seatCount, totalLabel, seatIds }: Props) {
  const router = useRouter();
  const { remainingMs, warn, expired, announcement } = useCountdown(expiresAt);
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // When the hold expires, bounce back to /seats so the user can re-pick.
  useEffect(() => {
    if (expired && !paying) {
      const t = setTimeout(() => router.replace("/seats"), 2000);
      return () => clearTimeout(t);
    }
  }, [expired, paying, router]);

  const onPay = async () => {
    if (paying || expired || seatCount === 0) return;
    setPaying(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(
          `/checkout?seats=${seatIds.join(",")}`,
        )}`;
        return;
      }
      if (res.status === 410) {
        // Holds expired server-side — bounce to /seats with a notice.
        router.replace("/seats");
        return;
      }
      if (!res.ok || !body.url) {
        setErrorMsg(body.error ?? copy.checkout.payError);
        setPaying(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setErrorMsg(copy.checkout.payError);
      setPaying(false);
    }
  };

  return (
    <>
      <TimerBar
        remainingMs={remainingMs}
        warn={warn}
        expired={expired}
        announcement={announcement}
      />
      <PayBar
        seatCount={seatCount}
        totalLabel={totalLabel}
        paying={paying}
        disabled={expired || seatCount === 0}
        onPay={onPay}
        errorMsg={errorMsg}
      />
    </>
  );
}

function TimerBar({
  remainingMs,
  warn,
  expired,
  announcement,
}: {
  remainingMs: number;
  warn: boolean;
  expired: boolean;
  announcement: string;
}) {
  return (
    <div
      className="
        flex items-baseline justify-between gap-3
        border-b border-ash/20 pb-3
      "
    >
      <span
        className="font-mono text-[0.625rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.checkout.timerPrefix}
      </span>
      <span
        aria-hidden="true"
        className={`
          font-mono text-base [font-variant-numeric:tabular-nums]
          transition-colors duration-500 ease-out-quart
          ${expired ? "text-gold" : warn ? "text-gold" : "text-bulb/95"}
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

function PayBar({
  seatCount,
  totalLabel,
  paying,
  disabled,
  onPay,
  errorMsg,
}: {
  seatCount: number;
  totalLabel: string;
  paying: boolean;
  disabled: boolean;
  onPay: () => void;
  errorMsg: string | null;
}) {
  // We bind the CTA label to the live total in case the server passed a stale
  // count somehow; recompute defensively.
  const liveTotal = formatTotalLPS(seatCount);
  const ctaLabel = paying
    ? copy.checkout.payingLabel
    : copy.checkout.payCta(liveTotal || totalLabel);
  return (
    <div className="flex flex-col gap-3 pt-2">
      <button
        type="button"
        onClick={onPay}
        disabled={disabled || paying}
        aria-busy={paying || undefined}
        className="
          group relative inline-flex items-center justify-center
          min-h-14 w-full
          px-6 py-3
          font-body font-medium text-base uppercase
          bg-gold text-hall border border-gold
          transition-[background,box-shadow,opacity] duration-200 ease-out-quart
          hover:bg-gold-deep
          hover:shadow-[0_0_0_5px_var(--color-gold-glow)]
          focus-visible:outline-none
          focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
          disabled:opacity-60 disabled:cursor-not-allowed
          disabled:hover:bg-gold disabled:hover:shadow-none
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {paying && (
          <span
            aria-hidden="true"
            className="
              mr-2 inline-block h-3 w-3 rounded-full border-2
              border-hall/30 border-t-hall animate-spin
            "
          />
        )}
        {ctaLabel}
      </button>
      <p
        className="m-0 text-center font-mono text-[0.6875rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.checkout.trustLine}
      </p>
      {errorMsg && (
        <p
          role="alert"
          className="m-0 text-center font-mono text-[0.6875rem] uppercase text-gold"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {errorMsg}
        </p>
      )}
    </div>
  );
}
