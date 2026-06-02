"use client";

import { copy } from "@/lib/copy";

type Item = {
  key: string;
  label: string;
  cls: string;
  glyph?: boolean;
};

const items: Item[] = [
  {
    key: "available",
    label: copy.seats.legend.available,
    cls: "border-bulb/40 bg-transparent",
  },
  {
    key: "selected",
    label: copy.seats.legend.selected,
    cls: "border-gold bg-gold",
  },
  {
    key: "accessible",
    label: copy.seats.legend.accessible,
    cls: "border-bulb/40 bg-transparent",
    glyph: true,
  },
  {
    key: "held",
    label: copy.seats.legend.held,
    cls: "border-bulb/30 seat-hatch-held",
  },
  {
    key: "taken",
    label: copy.seats.legend.taken,
    cls: "border-bulb/20 seat-hatch-taken opacity-65",
  },
];

export function SeatLegend() {
  return (
    <section
      aria-labelledby="seat-legend-label"
      className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-6"
    >
      <span
        id="seat-legend-label"
        className="font-mono text-[0.6875rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.seats.legend.label}
      </span>
      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 list-none m-0 p-0">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase text-bulb/65"
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            <span
              aria-hidden="true"
              className={`relative inline-flex h-3.5 w-3.5 items-center justify-center border ${it.cls}`}
            >
              {it.glyph && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-2.5 w-2.5 text-bulb/80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="4.5" r="1.5" />
                  <path d="M11 8v5h5l3 5" />
                  <path d="M11 13l-3 1.5a4.5 4.5 0 1 0 6 6.5" />
                </svg>
              )}
            </span>
            {it.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
