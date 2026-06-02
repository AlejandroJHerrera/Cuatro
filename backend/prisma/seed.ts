/**
 * Seed: one Movie (the CUATRO screening) + 121 Seats matching the real
 * SALA 4 layout used by the frontend (frontend/lib/seats.ts).
 *
 * Idempotent: re-running upserts the movie and seats by their natural keys.
 */
import { PrismaClient, SeatKind } from "@prisma/client";

const prisma = new PrismaClient();

type RowLayout = {
  row: string;
  startCol: number;
  count: number;
  accessible?: number[];
  gapAfterIndex?: number;
  gapWidth?: number;
};

// Mirrors ROW_LAYOUTS in frontend/lib/seats.ts. If that file changes, update here.
const ROW_LAYOUTS: readonly RowLayout[] = [
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

const MOVIE = {
  title: "CUATRO",
  director: "JOSE JAVIER DIAZ",
  synopsis:
    "Un documental sobre el álbum CUATRO de Jose Javier Diaz — cuatro canciones, cuatro estaciones, cuatro horizontes.",
  startsAt: new Date("2026-06-27T18:00:00-06:00"), // Honduras is UTC-6, no DST
  runtimeMin: 30,
  language: "ES",
  year: 2026,
  venueName: "CINEPOLIS ALTARA",
  venueAddress: "SAN PEDRO SULA",
  priceLps: 12,
};

async function main() {
  const movie = await prisma.movie.upsert({
    where: { id: "cuatro-screening" },
    update: { ...MOVIE },
    create: { id: "cuatro-screening", ...MOVIE },
  });

  let total = 0;
  for (const layout of ROW_LAYOUTS) {
    const accessibleSet = new Set(layout.accessible ?? []);
    const gapAfter = layout.gapAfterIndex ?? -1;
    const gapWidth = layout.gapWidth ?? 1;
    let col = layout.startCol;
    for (let n = 1; n <= layout.count; n++) {
      const label = `${layout.row}${n}`;
      await prisma.seat.upsert({
        where: { movieId_row_num: { movieId: movie.id, row: layout.row, num: n } },
        update: { col, label, kind: accessibleSet.has(n) ? SeatKind.accessible : SeatKind.standard },
        create: {
          movieId: movie.id,
          row: layout.row,
          num: n,
          col,
          label,
          kind: accessibleSet.has(n) ? SeatKind.accessible : SeatKind.standard,
        },
      });
      total++;
      col += 1;
      if (n === gapAfter) col += gapWidth;
    }
  }

  console.log(`Seeded movie "${movie.title}" with ${total} seats.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
