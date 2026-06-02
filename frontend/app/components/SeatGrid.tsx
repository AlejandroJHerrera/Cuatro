"use client";

import { useCallback, useMemo, useRef } from "react";
import { copy } from "@/lib/copy";
import {
  MASTER_COLS,
  ROWS,
  type Seat,
  seatLabel,
} from "@/lib/seats";

type Props = {
  seats: Seat[];
  selected: Set<string>;
  onToggle: (seat: Seat) => void;
};

/**
 * Renders SALA 4 — an irregular 9-row house, each row painted into a shared
 * 19-column master grid. Each row's cells are emitted in master-col order;
 * empty positions render as inert placeholder divs so the grid layout is
 * fully explicit (no reliance on implicit grid placement or fragile var()
 * substitutions in grid-template-columns).
 */
export function SeatGrid({ seats, selected, onToggle }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  // For each row, a map of master col → seat (sparse).
  const seatsByRowCol = useMemo(() => {
    const out = new Map<string, Map<number, Seat>>();
    for (const row of ROWS) out.set(row, new Map());
    for (const s of seats) out.get(s.row)?.set(s.col, s);
    return out;
  }, [seats]);

  const focusSeat = useCallback((row: string, num: number) => {
    const el = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-seat-row="${row}"][data-seat-num="${num}"]`,
    );
    el?.focus();
  }, []);

  const findNearestInRow = useCallback(
    (targetRow: string, fromCol: number): Seat | null => {
      const rowMap = seatsByRowCol.get(targetRow);
      if (!rowMap) return null;
      let best: Seat | null = null;
      let bestDist = Infinity;
      for (const s of rowMap.values()) {
        if (s.status === "taken") continue;
        const d = Math.abs(s.col - fromCol);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      return best;
    },
    [seatsByRowCol],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const row = target.dataset?.seatRow;
      const colStr = target.dataset?.seatCol;
      if (!row || !colStr) return;
      const col = Number(colStr);
      const rowIdx = ROWS.indexOf(row);
      if (rowIdx === -1) return;
      const rowMap = seatsByRowCol.get(row);

      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          if (rowIdx === 0) return;
          const next = findNearestInRow(ROWS[rowIdx - 1], col);
          if (next) focusSeat(next.row, next.num);
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          if (rowIdx === ROWS.length - 1) return;
          const next = findNearestInRow(ROWS[rowIdx + 1], col);
          if (next) focusSeat(next.row, next.num);
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          for (let c = col - 1; c >= 1; c--) {
            const s = rowMap?.get(c);
            if (s && s.status !== "taken") {
              focusSeat(s.row, s.num);
              break;
            }
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          for (let c = col + 1; c <= MASTER_COLS; c++) {
            const s = rowMap?.get(c);
            if (s && s.status !== "taken") {
              focusSeat(s.row, s.num);
              break;
            }
          }
          break;
        }
        case "Escape":
          (target as HTMLButtonElement).blur();
          break;
        default:
          break;
      }
    },
    [findNearestInRow, focusSeat, seatsByRowCol],
  );

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Screen indicator. */}
      <div className="flex w-full max-w-[48rem] flex-col items-center gap-3">
        <span
          className="font-display text-xs uppercase text-bulb/70 sm:text-sm"
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {copy.seats.screenLabel}
        </span>
        <span
          aria-hidden="true"
          className="block h-px w-full bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        />
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={copy.seats.a11y.gridName}
        onKeyDown={onKeyDown}
        className="grid w-full max-w-[48rem] gap-y-1.5 sm:gap-y-2"
      >
        {ROWS.map((row) => {
          const rowMap = seatsByRowCol.get(row);
          const cells: React.ReactNode[] = [];
          for (let mc = 1; mc <= MASTER_COLS; mc++) {
            const seat = rowMap?.get(mc);
            if (seat) {
              cells.push(
                <SeatTile
                  key={seat.id}
                  seat={seat}
                  isSelected={selected.has(seat.id)}
                  onToggle={onToggle}
                />,
              );
            } else {
              cells.push(
                <span
                  key={`gap-${row}-${mc}`}
                  aria-hidden="true"
                  className="block aspect-square"
                />,
              );
            }
          }
          return (
            <div
              key={row}
              role="row"
              className="
                grid items-center gap-1 sm:gap-1.5
                [grid-template-columns:1.5rem_repeat(19,1fr)]
                sm:[grid-template-columns:2rem_repeat(19,1fr)]
              "
            >
              <span
                role="rowheader"
                aria-label={`Fila ${row}`}
                className="
                  self-center text-center
                  font-mono text-[0.625rem] uppercase text-bulb/45
                "
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                {row}
              </span>
              {cells}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeatTile({
  seat,
  isSelected,
  onToggle,
}: {
  seat: Seat;
  isSelected: boolean;
  onToggle: (s: Seat) => void;
}) {
  const label = seatLabel(seat.row, seat.num);
  const status = seat.status;
  const interactive = status === "available";

  const baseA11yLabel = isSelected
    ? copy.seats.a11y.seatStatus.selected(label)
    : copy.seats.a11y.seatStatus[status](label);
  const a11yLabel =
    seat.kind === "accessible"
      ? `Butaca accesible. ${baseA11yLabel}`
      : baseA11yLabel;

  // Every state carries a soft off-white border so the seat grid reads as a
  // grid of objects, not blobs against the dark hall. Selected gets the gold
  // takeover, held/taken keep their hatch but with a brighter outline so the
  // shape stays visible.
  let visual = "";
  if (isSelected) {
    visual = "bg-gold border-gold shadow-[inset_0_0_0_1px_var(--color-gold-deep)]";
  } else if (status === "available") {
    visual =
      "bg-transparent border-bulb/40 hover:border-bulb hover:bg-bulb/[0.06]";
  } else if (status === "held") {
    visual = "border-bulb/30 seat-hatch-held";
  } else {
    visual = "border-bulb/20 seat-hatch-taken opacity-65";
  }

  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={isSelected}
      aria-label={a11yLabel}
      aria-disabled={!interactive || undefined}
      data-seat-row={seat.row}
      data-seat-num={seat.num}
      data-seat-col={seat.col}
      tabIndex={interactive ? 0 : -1}
      onClick={() => interactive && onToggle(seat)}
      className={`
        aspect-square border min-w-0
        flex items-center justify-center
        transition-[background,border-color,transform]
        duration-200 ease-out-quart
        focus-visible:outline-none
        focus-visible:shadow-[0_0_0_3px_var(--color-gold-glow)]
        ${interactive ? "cursor-pointer active:scale-[0.94]" : "cursor-not-allowed"}
        ${visual}
      `}
    >
      {seat.kind === "accessible" && (
        <AccessibleGlyph isSelected={isSelected} />
      )}
    </button>
  );
}

function AccessibleGlyph({ isSelected }: { isSelected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-2/3 w-2/3 ${isSelected ? "text-hall" : "text-bulb/80"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="4.5" r="1.5" />
      <path d="M11 8v5h5l3 5" />
      <path d="M11 13l-3 1.5a4.5 4.5 0 1 0 6 6.5" />
    </svg>
  );
}
