/**
 * Seat-hold operations. Hold lifetime is 10 minutes; the lazy purge in
 * services/seatStatus.ts keeps stale rows out of /api/seats reads.
 *
 * `replaceUserHolds` is the only mutation the frontend calls during selection:
 * it drops whatever the user was holding and atomically takes the new set.
 * Race-loser detection relies on the `@@unique` on SeatHold.seatId — a parallel
 * tx that committed first claims the row, and ours raises P2002.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const HOLD_DURATION_MS = 10 * 60 * 1000;
export const MAX_SEATS_PER_HOLD = 8;

export type HoldResult =
  | { ok: true; seatIds: string[]; expiresAt: number }
  | { ok: false; reason: "conflict"; conflictSeatIds: string[] }
  | { ok: false; reason: "missing"; missingSeatIds: string[] }
  | { ok: false; reason: "sold"; soldSeatIds: string[] };

/**
 * Drop the user's existing holds and place new ones on `seatLabels` for the
 * given movie. All-or-nothing — any conflict rolls the transaction back.
 */
export async function replaceUserHolds(
  userId: string,
  movieId: string,
  seatLabels: string[],
): Promise<HoldResult> {
  const expiresAt = new Date(Date.now() + HOLD_DURATION_MS);

  try {
    return await prisma.$transaction(async (tx) => {
      // Purge expired rows up front so reusing a just-expired seat works.
      await tx.seatHold.deleteMany({ where: { expiresAt: { lt: new Date() } } });

      const seats = await tx.seat.findMany({
        where: { movieId, label: { in: seatLabels } },
        include: { ticket: { select: { id: true } } },
      });

      if (seats.length !== seatLabels.length) {
        const found = new Set(seats.map((s) => s.label));
        const missing = seatLabels.filter((l) => !found.has(l));
        return { ok: false, reason: "missing", missingSeatIds: missing } as const;
      }
      const sold = seats.filter((s) => s.ticket).map((s) => s.label);
      if (sold.length > 0) {
        return { ok: false, reason: "sold", soldSeatIds: sold } as const;
      }

      // Release this user's existing holds before claiming the new set, so the
      // unique constraint only fires against *other* users' holds.
      await tx.seatHold.deleteMany({ where: { userId } });

      await tx.seatHold.createMany({
        data: seats.map((s) => ({ seatId: s.id, userId, expiresAt })),
      });

      return {
        ok: true,
        seatIds: seats.map((s) => s.label),
        expiresAt: expiresAt.getTime(),
      } as const;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Another user beat us to one or more seats. Re-read to tell the caller which.
      const conflicts = await prisma.seat.findMany({
        where: {
          movieId,
          label: { in: seatLabels },
          hold: { userId: { not: userId }, expiresAt: { gt: new Date() } },
        },
        select: { label: true },
      });
      return {
        ok: false,
        reason: "conflict",
        conflictSeatIds: conflicts.map((c) => c.label),
      };
    }
    throw err;
  }
}

export async function releaseUserHolds(userId: string): Promise<void> {
  await prisma.seatHold.deleteMany({ where: { userId } });
}

export async function getUserHolds(
  userId: string,
): Promise<{ seatIds: string[]; expiresAt: number } | null> {
  const holds = await prisma.seatHold.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    include: { seat: { select: { label: true } } },
  });
  if (holds.length === 0) return null;
  // All of a user's holds share an expiry (set in replaceUserHolds); pick the max defensively.
  const expiresAt = Math.max(...holds.map((h) => h.expiresAt.getTime()));
  return { seatIds: holds.map((h) => h.seat.label), expiresAt };
}
