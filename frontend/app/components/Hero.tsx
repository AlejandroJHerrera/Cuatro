import { copy } from "@/lib/copy";
import type { Movie, MovieStatus } from "@/lib/movie";
import {
  formatDateLine,
  formatVenueLine,
  posterAlt,
} from "@/lib/format";
import { CoverArt } from "./CoverArt";

export function Hero({ movie }: { movie: Movie }) {
  const dateLine = formatDateLine(movie.showtimeISO);
  const venueLine = formatVenueLine(movie);
  const alt = posterAlt(movie);

  return (
    <section
      aria-labelledby="film-title"
      className="relative isolate w-full min-h-screen min-h-[100svh] overflow-hidden"
    >
      <div
        className="
          absolute inset-0 z-0 opacity-0
          animate-poster-fade
          poster-scroll-scale
        "
        style={{ transformOrigin: "70% 50%" }}
      >
        <CoverArt alt={alt} />
      </div>

      {/* Mobile: bottom-heavy darken so the lower-third title reads. */}
      <div className="absolute inset-0 z-10 pointer-events-none hero-blend-bottom sm:hidden" />
      {/* sm+: blend the left side into Hall Black so the title block reads
          while the cover bleeds free on the right. */}
      <div className="absolute inset-0 z-10 pointer-events-none hidden sm:block hero-blend-right" />

      <div
        className="
          relative z-20 grid w-full
          min-h-screen min-h-[100svh]
          [grid-template-rows:1fr_auto_auto]
          px-6 pb-16 pt-32
          sm:px-12 sm:pb-24 sm:pt-40
          lg:px-24 lg:pb-32 lg:pt-48
        "
      >
        <div aria-hidden="true" />

        <div
          className="
            flex flex-col gap-4
            opacity-0 translate-y-3 animate-rise
            sm:max-w-[26ch]
          "
          style={{ animationDelay: "240ms" }}
        >
          <h1
            id="film-title"
            className="
              m-0 font-display font-light uppercase
              text-bulb leading-[0.92]
              text-[clamp(3.25rem,11vw,7.5rem)]
            "
            style={{
              letterSpacing: "var(--tracking-marquee)",
              textShadow: "0 1px 0 oklch(0.135 0.012 270 / 0.4)",
            }}
          >
            {movie.title.toUpperCase()}
          </h1>
          <p
            className="
              m-0 font-display italic font-light whitespace-nowrap
              text-bulb/85
              text-[clamp(1rem,2vw,1.5rem)]
              leading-snug
            "
            style={{ letterSpacing: "0.08em" }}
          >
            {copy.hero.subtitle}
          </p>
          <p
            className="
              mt-2 m-0 font-display uppercase text-bulb whitespace-nowrap
              text-[clamp(1rem,1.9vw,1.5rem)]
              leading-tight
            "
            style={{ letterSpacing: "0.03em" }}
          >
            {dateLine}
          </p>
          <p
            className="mt-1 font-mono uppercase text-bulb/70 text-xs"
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {venueLine}
          </p>
        </div>

        <div
          className="
            mt-12 flex flex-col items-start gap-4
            sm:items-center
            opacity-0 translate-y-3 animate-rise
          "
          style={{ animationDelay: "420ms" }}
        >
          <CtaSlot status={movie.status} title={movie.title} dateLine={dateLine} />
          <span
            aria-hidden="true"
            className="
              mt-6 inline-flex items-center gap-3
              font-mono text-xs uppercase text-bulb/50
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            <span className="inline-block h-px w-10 bg-bulb/50" />
            {copy.hero.scrollHint}
          </span>
        </div>
      </div>
    </section>
  );
}

function CtaSlot({
  status,
  title,
  dateLine,
}: {
  status: MovieStatus;
  title: string;
  dateLine: string;
}) {
  if (status === "sold-out") {
    return (
      <InertCtaCopy
        label={copy.states.soldOut.label}
        body={copy.states.soldOut.body}
      />
    );
  }
  if (status === "passed") {
    return (
      <InertCtaCopy
        label={copy.states.passed.label}
        body={copy.states.passed.body}
      />
    );
  }
  return (
    <a
      href="/signin?next=/seats"
      aria-label={`${copy.hero.cta} para ${title.toUpperCase()}, ${dateLine}`}
      className="
        group relative inline-flex items-center justify-center gap-2
        min-h-14 min-w-[18ch] sm:min-w-[28ch]
        px-10 sm:px-16 py-[1.1em]
        font-body font-medium text-base uppercase
        bg-gold text-hall border border-gold
        transition-[background,color,transform,box-shadow]
        duration-200 ease-out-quart
        hover:bg-gold-deep
        hover:shadow-[0_0_0_6px_var(--color-gold-glow)]
        active:translate-y-px
        focus-visible:outline-none
        focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
      "
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      {copy.hero.cta}
    </a>
  );
}

function InertCtaCopy({ label, body }: { label: string; body: string }) {
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        className="
          inline-flex items-center justify-center
          min-h-14 min-w-[18ch]
          px-10 py-[1.1em]
          font-body font-medium text-base uppercase
          bg-transparent text-bulb/60
          border border-ash/50
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {label}
      </span>
      <p className="max-w-[36ch] text-base leading-[1.5] text-bulb/70">
        {body}
      </p>
    </>
  );
}
