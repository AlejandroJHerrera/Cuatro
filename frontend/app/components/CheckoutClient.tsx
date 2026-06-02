"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";
import { formatMMSS, useCountdown } from "@/lib/useCountdown";
import { PaymentInstructionsCard } from "./PaymentInstructionsCard";
import { ScreenshotUploader } from "./ScreenshotUploader";
import { submitScreenshot, type VerifyResult } from "@/lib/checkoutVerify";

type Props = {
  expiresAt: number | null;
  seatCount: number;
  seatIds: string[];
  totalLps: number;
  orderCode: string;
  bankRef: string;
};

export function CheckoutClient({ expiresAt, seatCount, seatIds, totalLps, orderCode, bankRef }: Props) {
  const router = useRouter();
  const { remainingMs, warn, expired, announcement } = useCountdown(expiresAt);
  const [phase, setPhase] = useState<"idle" | "verifying" | "softCap">("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const startedVerifyingAt = useRef<number | null>(null);

  useEffect(() => {
    if (expired && phase === "idle") {
      const t = setTimeout(() => router.replace("/seats"), 2000);
      return () => clearTimeout(t);
    }
  }, [expired, phase, router]);

  useEffect(() => {
    if (phase !== "verifying") return;
    const t = setTimeout(() => setPhase((p) => (p === "verifying" ? "softCap" : p)), 30_000);
    return () => clearTimeout(t);
  }, [phase]);

  async function submit(file: File) {
    setPhase("verifying");
    startedVerifyingAt.current = Date.now();
    const r = await submitScreenshot(file);
    setResult(r);

    if (r.status === "approved") {
      router.push(`/success?order=${r.orderCode}`);
      return;
    }
    if (r.status === "pending") {
      setPhase("softCap");
      return;
    }
    if (r.status === "attempts-exhausted" || r.status === "holds-expired") {
      router.replace(`/seats?flash=${r.status}`);
      return;
    }
    setPhase("idle");
  }

  // seatCount + seatIds are accepted but only seatCount is read here; seatIds reserved for future toolbar use.
  void seatIds;
  void seatCount;

  return (
    <>
      <TimerBar remainingMs={remainingMs} warn={warn} expired={expired} announcement={announcement} />

      {phase === "verifying" && <Verifying />}
      {phase === "softCap" && <SoftCap />}

      {phase === "idle" && (
        <div className="flex flex-col gap-6">
          <PaymentInstructionsCard bankRef={bankRef} amountLps={totalLps} orderCode={orderCode} />
          {result?.status === "rejected" && (
            <div role="alert" className="border border-gold/40 p-4 flex flex-col gap-1">
              <p className="m-0 font-mono text-sm text-gold">{result.detail}</p>
              <p
                className="m-0 font-mono text-[0.6875rem] uppercase text-bulb/55"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                {copy.checkout.rejected.attemptsLeft(result.attemptsLeft)}
              </p>
            </div>
          )}
          <ScreenshotUploader
            onSubmit={submit}
            busy={false}
            retryLabel={result?.status === "rejected"}
          />
        </div>
      )}
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
    <div className="flex items-baseline justify-between gap-3 border-b border-ash/20 pb-3">
      <span
        className="font-mono text-[0.625rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.checkout.timerPrefix}
      </span>
      <span
        aria-hidden="true"
        className={`font-mono text-base [font-variant-numeric:tabular-nums] transition-colors duration-500 ease-out-quart ${
          expired || warn ? "text-gold" : "text-bulb/95"
        }`}
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

function Verifying() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <span className="inline-block w-3 h-3 bg-gold animate-pulse rounded-full" />
      <p className="m-0 font-mono text-sm text-bulb/85">{copy.checkout.verifying}</p>
    </div>
  );
}

function SoftCap() {
  return (
    <p className="text-center font-mono text-sm text-bulb/85 py-12 leading-relaxed">
      {copy.checkout.softCap}
    </p>
  );
}
