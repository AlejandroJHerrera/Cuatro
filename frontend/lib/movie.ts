/**
 * Movie data fetch with a placeholder fallback.
 *
 * Backend wiring lands later (PLAN.md phase 2): GET ${API_URL}/api/movie.
 * Until then, this returns a deterministic placeholder so the landing renders
 * end-to-end. The shape is the contract the backend will need to honor.
 */
export type MovieStatus = "selling" | "sold-out" | "passed";

export type Movie = {
  status: MovieStatus;
  showtimeISO: string;
  title: string;
  director: string;
  runtimeMin: number;
  language: string;
  year: number;
  venueName: string;
  venueAddress: string;
};

const PLACEHOLDER: Movie = {
  status: "selling",
  showtimeISO: "2026-06-27T18:00:00+02:00",
  title: "CUATRO",
  director: "JOSE JAVIER DIAZ",
  runtimeMin: 30,
  language: "ES",
  year: 2026,
  venueName: "CINEPOLIS ALTARA",
  venueAddress: "SAN PEDRO SULA",
};

export async function getMovie(): Promise<
  { ok: true; movie: Movie } | { ok: false }
> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return { ok: true, movie: PLACEHOLDER };
  }
  try {
    const res = await fetch(`${apiUrl}/api/movie`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return { ok: false };
    const movie = (await res.json()) as Movie;
    return { ok: true, movie };
  } catch {
    return { ok: false };
  }
}
