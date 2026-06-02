"use client";

import { copy } from "@/lib/copy";
import { formatTotalLPS, type Seat, seatLabel } from "@/lib/seats";
import { HoldTimer } from "./HoldTimer";

type Props = {
  selectedSeats: Seat[];
  onRemove: (seatId: string) => void;
  holdExpiresAt: number | null;
  maxNotice: boolean;
  expired: boolean;
  conflictNotice?: string | null;
};

export function CartPanel({
  selectedSeats,
  onRemove,
  holdExpiresAt,
  maxNotice,
  expired,
  conflictNotice,
}: Props) {
  const count = selectedSeats.length;
  const isEmpty = count === 0;

  return (
    <aside
      aria-label="Resumen de tu reserva"
      className="
        lg:sticky lg:top-12 lg:self-start
        fixed inset-x-0 bottom-0 z-40
        lg:static lg:inset-auto lg:z-auto
        bg-curtain
        border-t border-ash/30 lg:border-t-0 lg:border-l lg:border-ash/25
        pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 px-6
        lg:pb-8 lg:pl-8 lg:pr-4 lg:pt-8
        lg:min-h-[20rem]
        flex flex-col gap-4
      "
    >
      {/* Notice slot — sits above everything, no layout shift when absent. */}
      <NoticeSlot
        maxNotice={maxNotice}
        expired={expired}
        conflictNotice={conflictNotice ?? null}
      />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {holdExpiresAt && <HoldTimer expiresAt={holdExpiresAt} />}

          <div className="flex flex-col gap-2">
            <span
              className="font-mono text-[0.6875rem] uppercase text-bulb/55"
              style={{ letterSpacing: "var(--tracking-label)" }}
            >
              {count === 1
                ? copy.seats.cart.countSingular(count)
                : copy.seats.cart.countPlural(count)}
            </span>
            <ul className="flex flex-wrap gap-1.5 list-none m-0 p-0">
              {selectedSeats.map((s) => {
                const label = seatLabel(s.row, s.num);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onRemove(s.id)}
                      aria-label={copy.seats.cart.removeAria(label)}
                      className="
                        group inline-flex items-center gap-1.5
                        border border-gold/70 bg-gold/10
                        px-2 py-1
                        font-display text-sm uppercase text-bulb
                        transition-colors duration-200 ease-out-quart
                        hover:bg-gold/20 hover:border-gold
                      "
                      style={{ letterSpacing: "0.05em" }}
                    >
                      <span>{label}</span>
                      <span
                        aria-hidden="true"
                        className="inline-block font-mono text-[0.7rem] text-bulb/60 transition-colors duration-200 ease-out-quart group-hover:text-bulb"
                      >
                        ✕
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-auto flex flex-col gap-3 lg:mt-2">
            <div
              className="flex items-baseline justify-between font-mono text-sm text-bulb/85 [font-variant-numeric:tabular-nums]"
              style={{ letterSpacing: "var(--tracking-label)" }}
            >
              <span className="text-bulb/55 uppercase text-[0.6875rem]">
                TOTAL
              </span>
              <span>{formatTotalLPS(count)}</span>
            </div>
            <a
              href={buildCheckoutHref(selectedSeats, holdExpiresAt)}
              className="
                inline-flex items-center justify-center gap-2
                min-h-12 w-full
                px-6 py-3
                font-body font-medium text-sm uppercase
                bg-gold text-hall border border-gold
                transition-[background,box-shadow] duration-200 ease-out-quart
                hover:bg-gold-deep
                hover:shadow-[0_0_0_4px_var(--color-gold-glow)]
                focus-visible:outline-none
                focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
              "
              style={{ letterSpacing: "var(--tracking-label)" }}
            >
              {copy.seats.cart.continue}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </>
      )}
    </aside>
  );
}

function buildCheckoutHref(
  seats: Seat[],
  expiresAt: number | null,
): string {
  const params = new URLSearchParams();
  params.set("seats", seats.map((s) => s.id).join(","));
  if (expiresAt) params.set("expires", String(expiresAt));
  return `/checkout?${params.toString()}`;
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-1.5 py-2 lg:py-6">
      <p
        className="m-0 font-display text-xl uppercase text-bulb"
        style={{ letterSpacing: "var(--tracking-marquee)" }}
      >
        {copy.seats.cart.emptyHeading}
      </p>
      <p className="m-0 font-body text-sm text-bulb/65">
        {copy.seats.cart.emptyBody}
      </p>
    </div>
  );
}

function NoticeSlot({
  maxNotice,
  expired,
  conflictNotice,
}: {
  maxNotice: boolean;
  expired: boolean;
  conflictNotice: string | null;
}) {
  if (!maxNotice && !expired && !conflictNotice) return null;
  // Priority: expired > conflict > max (most urgent first).
  const text = expired
    ? copy.seats.cart.expiredNotice
    : conflictNotice
      ? conflictNotice
      : copy.seats.cart.maxNotice;
  const accent = expired || conflictNotice;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`
        m-0 font-mono text-[0.6875rem] uppercase
        ${accent ? "text-gold" : "text-bulb/75"}
      `}
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      {text}
    </p>
  );
}
