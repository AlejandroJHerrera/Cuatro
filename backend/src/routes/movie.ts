import { Router } from "express";
import { getActiveMovie } from "../services/movie.js";

export const movieRouter = Router();

movieRouter.get("/", async (_req, res) => {
  const movie = await getActiveMovie();
  if (!movie) {
    res.status(404).json({ error: "No movie configured." });
    return;
  }
  res.json(movie);
});
