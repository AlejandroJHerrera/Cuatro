"use client";

import { useState } from "react";
import { copy } from "@/lib/copy";

type Props = {
  /** Order to resend. Threaded through for the future POST; ignored by the mock. */
  orderId?: string;
  /** Visual variant: solid ghost on /success, lighter inline on /my-tickets. */
  variant?: "ghost" | "inline";
};

/**
 * Mocked "resend email" CTA. Locks for ~2s and flips to a confirmation state.
 * Real wire-up lands when the Resend integration arrives (PLAN phase 7):
 *   POST /api/orders/:id/resend-email.
 */
export function ResendEmailButton({ orderId: _orderId, variant = "ghost" }: Props = {}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  const onClick = () => {
    if (state !== "idle") return;
    setState("sending");
    // MOCK: real POST /api/orders/:id/resend-email arrives with backend phase 7.
    setTimeout(() => setState("sent"), 1200);
  };

  const label =
    state === "sent" ? copy.success.resendSentLabel : copy.success.resendCta;

  const baseClass =
    variant === "inline"
      ? `
          inline-flex items-center
          font-mono text-[0.6875rem] uppercase text-bulb
          border-b border-ash/35 pb-px
          transition-[color,border-color,opacity] duration-200 ease-out-quart
          hover:text-gold hover:border-gold
          focus-visible:outline-none focus-visible:text-gold focus-visible:border-gold
          disabled:opacity-70 disabled:cursor-default
        `
      : `
          inline-flex items-center justify-center
          min-h-12 px-7 py-3
          font-body font-medium text-sm uppercase
          border border-ash/45 text-bulb
          transition-[color,border-color,opacity] duration-200 ease-out-quart
          hover:text-gold hover:border-gold
          focus-visible:outline-none
          focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
          disabled:opacity-70 disabled:cursor-default
        `;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== "idle"}
      aria-live="polite"
      className={baseClass}
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      {state === "sending" && (
        <span
          aria-hidden="true"
          className="
            mr-2 inline-block h-3 w-3 rounded-full border-2
            border-ash/40 border-t-bulb animate-spin
          "
        />
      )}
      {label}
    </button>
  );
}
