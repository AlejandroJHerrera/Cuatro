import { Router } from "express";
import { prisma } from "../db.js";
import { getSeatsWithStatus } from "../services/seatStatus.js";

export const seatsRouter = Router();

seatsRouter.get("/", async (_req, res) => {
  const movie = await prisma.movie.findFirst({ orderBy: { startsAt: "asc" }, select: { id: true } });
  if (!movie) {
    res.status(404).json({ error: "No movie configured." });
    return;
  }
  const seats = await getSeatsWithStatus(movie.id);
  res.json(seats);
});
