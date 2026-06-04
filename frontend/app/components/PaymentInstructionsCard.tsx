"use client";
import { useState } from "react";
import { copy } from "@/lib/copy";

/** Copy that works on desktop + mobile: Clipboard API in secure contexts,
 *  with a legacy textarea/execCommand fallback for everything else. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS Safari needs an explicit range
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function PaymentInstructionsCard({
  bankRef,
  amountLps,
  orderCode,
}: {
  bankRef: string;
  amountLps: number;
  orderCode: string;
}) {
  return (
    <section className="border border-ash/35 p-5 flex flex-col gap-4">
      <p className="m-0 border-l-2 border-gold bg-gold/[0.06] px-4 py-3 text-gold text-sm leading-snug">
        {copy.checkout.instructions.referenceNote}
      </p>
      <header className="flex flex-col gap-1">
        <span
          className="font-mono text-[0.6875rem] uppercase text-bulb/55"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.instructions.title}
        </span>
        <p className="m-0 text-bulb/85 text-sm leading-snug">{copy.checkout.instructions.body}</p>
      </header>
      <dl className="flex flex-col gap-3 font-mono text-sm [font-variant-numeric:tabular-nums]">
        <Row label={copy.checkout.instructions.accountLabel} value={bankRef} />
        <Row
          label={copy.checkout.instructions.amountLabel}
          value={`L ${amountLps.toFixed(2)}`}
          copyValue={amountLps.toFixed(2)}
        />
        <Row label={copy.checkout.instructions.referencePrefix} value={orderCode} />
      </dl>
    </section>
  );
}

function Row({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyText(copyValue ?? value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ash/20 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-bulb/55 text-[0.6875rem] uppercase" style={{ letterSpacing: "var(--tracking-label)" }}>
        {label}
      </dt>
      <dd className="m-0 flex items-baseline gap-3 text-right text-bulb">
        <span className="break-all">{value}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 font-mono text-[0.625rem] uppercase text-gold border-b border-gold/40 hover:border-gold transition-colors py-1"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copied ? copy.checkout.instructions.copied : copy.checkout.instructions.copy}
        </button>
      </dd>
    </div>
  );
}
