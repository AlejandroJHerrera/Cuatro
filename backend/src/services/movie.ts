/**
 * Movie projection for GET /api/movie.
 *
 * Status is derived: "passed" once showtime is past; "sold-out" if every seat
 * has a Ticket; "selling" otherwise. The frontend uses this to swap the
 * landing-page hero copy and CTA.
 */
import { prisma } from "../db.js";

export type MovieDTO = {
  status: "selling" | "sold-out" | "passed";
  showtimeISO: string;
  title: string;
  director: string;
  runtimeMin: number;
  language: string;
  year: number;
  venueName: string;
  venueAddress: string;
};

export async function getActiveMovie(): Promise<MovieDTO | null> {
  const movie = await prisma.movie.findFirst({ orderBy: { startsAt: "asc" } });
  if (!movie) return null;

  let status: MovieDTO["status"] = "selling";
  if (movie.startsAt.getTime() < Date.now()) {
    status = "passed";
  } else {
    const [seatCount, ticketCount] = await Promise.all([
      prisma.seat.count({ where: { movieId: movie.id } }),
      prisma.ticket.count({ where: { seat: { movieId: movie.id } } }),
    ]);
    if (seatCount > 0 && ticketCount >= seatCount) status = "sold-out";
  }

  return {
    status,
    showtimeISO: movie.startsAt.toISOString(),
    title: movie.title,
    director: movie.director,
    runtimeMin: movie.runtimeMin,
    language: movie.language,
    year: movie.year,
    venueName: movie.venueName,
    venueAddress: movie.venueAddress,
  };
}
