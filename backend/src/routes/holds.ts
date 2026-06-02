/**
 * Seat-hold endpoints. The frontend calls POST after each selection change
 * (replace semantics) and DELETE when the user clears the cart or signs out.
 *
 *   POST   /api/holds   { seatIds: string[] } -> { seatIds, expiresAt }
 *   DELETE /api/holds                          -> { ok: true }
 *   GET    /api/holds/me                       -> { seatIds, expiresAt } | { holds: null }
 */
import { Router, type Request } from "express";
import { z } from "zod";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import {
  MAX_SEATS_PER_HOLD,
  getUserHolds,
  releaseUserHolds,
  replaceUserHolds,
} from "../services/holds.js";

export const holdsRouter = Router();

const seatLabel = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{1,2}$/u, "ID de butaca inválido.");

const holdSchema = z.object({
  seatIds: z
    .array(seatLabel)
    .min(1, "Selecciona al menos una butaca.")
    .max(MAX_SEATS_PER_HOLD, `Máximo ${MAX_SEATS_PER_HOLD} butacas por orden.`)
    .transform((ids) => Array.from(new Set(ids))),
});

async function getDefaultMovieId(): Promise<string | null> {
  const movie = await prisma.movie.findFirst({
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  return movie?.id ?? null;
}

function userId(req: Request): string {
  return (req.user as User).id;
}

holdsRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = holdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." });
      return;
    }
    const movieId = await getDefaultMovieId();
    if (!movieId) {
      res.status(404).json({ error: "No movie configured." });
      return;
    }

    const result = await replaceUserHolds(userId(req), movieId, parsed.data.seatIds);
    if (result.ok) {
      res.json({ seatIds: result.seatIds, expiresAt: result.expiresAt });
      return;
    }
    switch (result.reason) {
      case "conflict":
        res.status(409).json({
          error: "Alguien tomó esas butacas antes que tú.",
          conflictSeatIds: result.conflictSeatIds,
        });
        return;
      case "sold":
        res.status(409).json({
          error: "Esas butacas ya están vendidas.",
          conflictSeatIds: result.soldSeatIds,
        });
        return;
      case "missing":
        res.status(404).json({
          error: "Butacas no encontradas.",
          missingSeatIds: result.missingSeatIds,
        });
        return;
    }
  } catch (err) {
    next(err);
  }
});

holdsRouter.delete("/", requireAuth, async (req, res, next) => {
  try {
    await releaseUserHolds(userId(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

holdsRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const holds = await getUserHolds(userId(req));
    res.json(holds ?? { holds: null });
  } catch (err) {
    next(err);
  }
});
