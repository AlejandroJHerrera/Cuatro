import { copy } from "@/lib/copy";
import { parseSeatId, seatLabel } from "@/lib/seats";
import { QrBlock } from "./QrBlock";

type Props = {
  seatId: string;
  orderId: string;
  guestName: string | null;
  dateLine: string;
  venueLine: string;
  /** Alternates the slight rotation direction on tablet+. */
  index: number;
  qrPayload?: string;
};

/**
 * Per-seat ticket stub. Serif seat ID is the centerpiece; everything else is
 * mono operationalia. Thin Marquee Gold frame — the one place gold is allowed
 * to occupy more than 5% of the surface, because the stub IS the surface.
 *
 * Slight alternating rotation appears at sm+ to suggest a stack of physical
 * stubs; collapsed to 0 under prefers-reduced-motion via CSS in globals.
 */
export function TicketStub({
  seatId,
  orderId,
  guestName,
  dateLine,
  venueLine,
  index,
  qrPayload,
}: Props) {
  const parsed = parseSeatId(seatId);
  const label = parsed ? seatLabel(parsed.row, parsed.num) : seatId;
  const tilt = index % 2 === 0 ? "sm:-rotate-[0.6deg]" : "sm:rotate-[0.6deg]";

  return (
    <article
      className={`
        relative
        flex flex-col
        w-full
        border border-gold/85
        bg-curtain/40
        px-8 py-10
        sm:px-10 sm:py-12
        ${tilt}
        motion-reduce:rotate-0
        transition-transform duration-300 ease-out-quart
        hover:rotate-0 hover:bg-curtain/60
      `}
    >
      {/* Eyebrow */}
      <span
        className="
          font-mono text-[0.625rem] uppercase text-bulb/55
          [font-variant-numeric:tabular-nums]
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.success.stubLabel}
      </span>

      {/* Serif seat ID centerpiece */}
      <div
        className="
          mt-3 mb-8
          font-display font-light uppercase text-bulb
          text-[clamp(3.5rem,12vw,5.5rem)] leading-[0.95]
          [font-variant-numeric:tabular-nums]
        "
        style={{ letterSpacing: "var(--tracking-marquee)" }}
        aria-label={`Butaca ${label}`}
      >
        {label}
      </div>

      {qrPayload && (
        <div className="mt-3 flex justify-center">
          <QrBlock payload={qrPayload} size={144} />
        </div>
      )}

      {/* Operational stamps */}
      <dl
        className="
          grid grid-cols-[auto_1fr] gap-x-5 gap-y-2
          font-mono text-[0.6875rem] uppercase
          [font-variant-numeric:tabular-nums]
          border-t border-ash/25 pt-5
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <dt className="text-bulb/55">{copy.success.stubGuestLabel}</dt>
        <dd className="m-0 text-bulb">
          {guestName ?? copy.success.stubGuestPlaceholder}
        </dd>

        <dt className="sr-only">Función</dt>
        <dd className="m-0 text-bulb col-span-2 sm:col-span-1 sm:col-start-2">
          {dateLine}
        </dd>

        <dt className="sr-only">Sala</dt>
        <dd className="m-0 text-bulb/75 col-span-2 sm:col-span-1 sm:col-start-2">
          {venueLine}
        </dd>

        <dt className="text-bulb/55">{copy.success.stubOrderLabel}</dt>
        <dd className="m-0 text-bulb">{orderId}</dd>
      </dl>
    </article>
  );
}
