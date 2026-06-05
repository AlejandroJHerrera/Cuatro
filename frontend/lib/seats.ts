/**
 * Real venue layout — SALA 4, Cinepolis Altara.
 *
 * The house is irregular: front rows narrower, row H wider and aligned-right
 * with the main block, row I is the widest with a center aisle. Every seat
 * carries its master-grid column so the renderer can place rows independently.
 *
 * Backend wiring lands later (PLAN.md phase 2): GET ${API_URL}/api/seats.
 * Until then, getSeats() returns a deterministic placeholder.
 */

export type SeatStatus = "available" | "held" | "taken";
export type SeatKind = "standard" | "accessible";

export type Seat = {
  /** "A" .. "I" */
  row: string;
  /** 1-indexed position within the row (visible to the user, used in seat IDs). */
  num: number;
  /** 1-indexed master grid column (1..MASTER_COLS). Determines visual placement. */
  col: number;
  /** Stable server-side id; in the mock we use `${row}${num}`. */
  id: string;
  kind: SeatKind;
  status: SeatStatus;
};

/** Visual master grid: 19 columns. Each row paints into a subset. */
export const MASTER_COLS = 19;

/**
 * Row layout in master-grid coordinates.
 *
 *   startCol      = master column of seat #1
 *   count         = number of seats in the row
 *   accessible    = 1-indexed positions within the row that are ♿
 *   gapAfterIndex = if present, an empty column is inserted AFTER this seat
 *                   number (1-indexed), and subsequent seats jump past it.
 *   gapWidth      = how many master columns the gap spans (default 1).
 */
type RowLayout = {
  row: string;
  startCol: number;
  count: number;
  accessible?: number[];
  gapAfterIndex?: number;
  gapWidth?: number;
};

export const ROW_LAYOUTS: readonly RowLayout[] = [
  { row: "A", startCol: 6, count: 11, accessible: [1, 5, 7, 11] },
  { row: "B", startCol: 6, count: 13 },
  { row: "C", startCol: 6, count: 13 },
  { row: "D", startCol: 6, count: 13 },
  { row: "E", startCol: 6, count: 13 },
  { row: "F", startCol: 6, count: 13 },
  { row: "G", startCol: 6, count: 13 },
  { row: "H", startCol: 4, count: 15 },
  { row: "I", startCol: 1, count: 17, gapAfterIndex: 11, gapWidth: 2 },
];

export const ROWS = ROW_LAYOUTS.map((r) => r.row);
export const MAX_SEATS_PER_ORDER = 121;
export const PRICE_PER_SEAT_LPS = 1000;
export const HOLD_DURATION_MS = 20 * 60 * 1000;

export function seatKey(row: string, num: number): string {
  return `${row}${num}`;
}

/** "A·7" — the user-facing seat ID. */
export function seatLabel(row: string, num: number): string {
  return `${row}·${num}`;
}

/** Build the seat list from ROW_LAYOUTS with all seats marked `available`. */
function buildSeatGrid(): Seat[] {
  const seats: Seat[] = [];
  for (const layout of ROW_LAYOUTS) {
    const accessibleSet = new Set(layout.accessible ?? []);
    const gapAfter = layout.gapAfterIndex ?? -1;
    const gapWidth = layout.gapWidth ?? 1;
    let col = layout.startCol;
    for (let n = 1; n <= layout.count; n++) {
      seats.push({
        row: layout.row,
        num: n,
        col,
        id: seatKey(layout.row, n),
        kind: accessibleSet.has(n) ? "accessible" : "standard",
        status: "available",
      });
      col += 1;
      if (n === gapAfter) col += gapWidth;
    }
  }
  return seats;
}

/** Deterministic placeholder — sprinkles held/taken seats to exercise states. */
function placeholderSeats(): Seat[] {
  const seats = buildSeatGrid();
  const taken = new Set([
    "B1",
    "B13",
    "C3",
    "C11",
    "D5",
    "E2",
    "E10",
    "F7",
    "G4",
    "G5",
    "H1",
    "H12",
    "H15",
    "I3",
    "I8",
    "I15",
  ]);
  const held = new Set(["A3", "B7", "D11", "F2", "H5", "I11"]);
  return seats.map((s) => {
    if (taken.has(s.id)) return { ...s, status: "taken" };
    if (held.has(s.id)) return { ...s, status: "held" };
    return s;
  });
}

export async function getSeats(): Promise<
  { ok: true; seats: Seat[] } | { ok: false }
> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return { ok: true, seats: placeholderSeats() };
  }
  try {
    const res = await fetch(`${apiUrl}/api/seats`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    const seats = (await res.json()) as Seat[];
    return { ok: true, seats };
  } catch {
    return { ok: false };
  }
}

/** "$36.00 LPS" */
export function formatTotalLPS(seatCount: number): string {
  const total = (seatCount * PRICE_PER_SEAT_LPS).toFixed(2);
  return `$${total} LPS`;
}

/** "$12.00" (no currency suffix; used in per-row price column). */
export function formatPriceLPS(): string {
  return `$${PRICE_PER_SEAT_LPS.toFixed(2)}`;
}

/** Parse "A11" → { row: "A", num: 11 }. Returns null on malformed input. */
export function parseSeatId(id: string): { row: string; num: number } | null {
  const m = /^([A-Z])(\d{1,2})$/.exec(id);
  if (!m) return null;
  return { row: m[1], num: Number(m[2]) };
}
