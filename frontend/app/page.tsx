import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { getMovie } from "@/lib/movie";
import {
  formatDateLine,
  formatFormula,
  formatSpecLine,
  formatVenueAddress,
} from "@/lib/format";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { ProgrammerNote } from "./components/ProgrammerNote";
import { Tracklist } from "./components/Tracklist";
import { Footer } from "./components/Footer";
import { ErrorFallback } from "./components/ErrorFallback";

export async function generateMetadata(): Promise<Metadata> {
  const result = await getMovie();
  if (!result.ok) {
    return {
      title: copy.brand.wordmark,
      description: copy.meta.descriptionFallback,
    };
  }
  const { movie } = result;
  const dateLine = formatDateLine(movie.showtimeISO);
  const venue = formatVenueAddress(movie);
  return {
    title: `${movie.title.toUpperCase()} — Función única`,
    description: `Estreno único del documental ${movie.title} de ${movie.director}. ${dateLine}. ${venue}.`,
    openGraph: {
      title: `${movie.title} — Función única`,
      description: `Estreno único. ${dateLine}. ${venue}.`,
      locale: "es_ES",
      type: "website",
    },
  };
}

export default async function LandingPage() {
  const result = await getMovie();

  if (!result.ok) {
    return <ErrorFallback />;
  }

  const { movie } = result;
  const specLine = formatSpecLine(movie);
  const formula = formatFormula(movie);
  const venueAddress = formatVenueAddress(movie);

  return (
    <main className="relative w-full">
      <Header specLine={specLine} />
      <Hero movie={movie} />
      <span
        id="contenido"
        aria-hidden="true"
        className="absolute left-0 top-[100svh]"
      />
      <ProgrammerNote />
      <Tracklist />
      <Footer formula={formula} venueAddress={venueAddress} />
    </main>
  );
}
