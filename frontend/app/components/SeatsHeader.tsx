import { copy } from "@/lib/copy";
import type { Movie } from "@/lib/movie";
import { formatDateLine, formatVenueLine } from "@/lib/format";

export function SeatsHeader({ movie }: { movie: Movie }) {
  const dateLine = formatDateLine(movie.showtimeISO);
  const venueLine = formatVenueLine(movie);
  return (
    <header
      className="
        sticky top-0 z-30
        bg-hall/95 backdrop-blur-sm
        border-b border-ash/20
        px-6 py-3 sm:px-12
        flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6
      "
    >
      <div className="flex items-baseline gap-3 sm:gap-5 min-w-0">
        <a
          href="/"
          className="
            font-display font-light uppercase text-bulb shrink-0
            text-xl sm:text-2xl
            transition-colors duration-200 ease-out-quart
            hover:text-gold
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {copy.brand.wordmark}
        </a>
        <span
          className="
            hidden sm:inline-block truncate
            font-mono text-[0.6875rem] uppercase text-bulb/65
            [font-variant-numeric:tabular-nums]
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {dateLine} · {venueLine}
        </span>
        <span
          className="
            inline-block sm:hidden truncate
            font-mono text-[0.625rem] uppercase text-bulb/65
            [font-variant-numeric:tabular-nums]
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {dateLine}
        </span>
      </div>
      <h1
        className="
          font-mono text-[0.625rem] uppercase text-bulb/55 m-0
          sm:text-[0.6875rem]
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.seats.pageTitle}
      </h1>
    </header>
  );
}
