"use client";
import { copy } from "@/lib/copy";

export function PaymentInstructionsCard({
  bankRef,
  amountLps,
  orderCode,
}: {
  bankRef: string;
  amountLps: number;
  orderCode: string;
}) {
  const onCopy = (s: string) => {
    if (typeof navigator !== "undefined") navigator.clipboard?.writeText(s);
  };
  return (
    <section className="border border-ash/35 p-5 flex flex-col gap-4">
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
        <Row label={copy.checkout.instructions.accountLabel} value={bankRef} onCopy={() => onCopy(bankRef)} />
        <Row label={copy.checkout.instructions.amountLabel} value={`L ${amountLps.toFixed(2)}`} onCopy={() => onCopy(amountLps.toFixed(2))} />
        <Row label={copy.checkout.instructions.referencePrefix} value={orderCode} onCopy={() => onCopy(orderCode)} />
      </dl>
      <p className="m-0 text-gold/90 text-xs leading-snug">
        {copy.checkout.instructions.referenceNote}
      </p>
    </section>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ash/20 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-bulb/55 text-[0.6875rem] uppercase" style={{ letterSpacing: "var(--tracking-label)" }}>
        {label}
      </dt>
      <dd className="m-0 flex items-baseline gap-3 text-right text-bulb">
        <span className="break-all">{value}</span>
        <button
          type="button"
          onClick={onCopy}
          className="font-mono text-[0.625rem] uppercase text-gold border-b border-gold/40 hover:border-gold transition-colors"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.checkout.instructions.copy}
        </button>
      </dd>
    </div>
  );
}
