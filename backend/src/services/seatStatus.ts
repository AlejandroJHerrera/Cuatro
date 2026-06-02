/**
 * Seat availability computation, used by GET /api/seats.
 *
 * A seat is "taken" if a Ticket exists, "held" if a non-expired SeatHold
 * exists, otherwise "available". Before returning, we lazily purge any
 * expired holds — cheap (<200 rows) and keeps the read path self-healing
 * without needing a background job.
 */
import { prisma } from "../db.js";

export type SeatStatusDTO = {
  id: string;
  row: string;
  num: number;
  col: number;
  kind: "standard" | "accessible";
  status: "available" | "held" | "taken";
};

export async function getSeatsWithStatus(movieId: string): Promise<SeatStatusDTO[]> {
  await prisma.seatHold.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const seats = await prisma.seat.findMany({
    where: { movieId },
    include: { ticket: { select: { id: true } }, hold: { select: { expiresAt: true } } },
    orderBy: [{ row: "asc" }, { num: "asc" }],
  });

  const now = Date.now();
  return seats.map((s) => {
    const status: SeatStatusDTO["status"] = s.ticket
      ? "taken"
      : s.hold && s.hold.expiresAt.getTime() > now
        ? "held"
        : "available";
    return {
      id: s.label,
      row: s.row,
      num: s.num,
      col: s.col,
      kind: s.kind,
      status,
    };
  });
}
