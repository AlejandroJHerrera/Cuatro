"use client";
import { useState } from "react";
import { copy } from "@/lib/copy";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Props = {
  orderCode: string;
  variant?: "ghost" | "inline";
};

export function ResendEmailButton({ orderCode, variant = "ghost" }: Props) {
  const [status, setStatus] = useState<"idle" | "busy" | "sent" | "error">("idle");

  async function onClick() {
    setStatus("busy");
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/${orderCode}/resend-email`, {
        method: "POST",
        credentials: "include",
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  const label =
    status === "sent" ? copy.success.resendSentLabel
    : status === "busy" ? "ENVIANDO…"
    : status === "error" ? "REINTENTAR"
    : copy.success.resendCta;

  const baseGhost = "inline-flex items-center justify-center min-h-12 px-5 py-2 font-mono text-[0.6875rem] uppercase border border-ash/35 text-bulb hover:border-gold hover:text-gold transition-colors";
  const baseInline = "font-mono text-[0.6875rem] uppercase text-bulb/85 border-b border-ash/35 hover:text-gold hover:border-gold transition-colors";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "busy" || status === "sent"}
      className={`${variant === "inline" ? baseInline : baseGhost} disabled:opacity-60 disabled:cursor-not-allowed`}
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      {label}
    </button>
  );
}
