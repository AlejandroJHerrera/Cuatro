/**
 * Spanish-formatted strings derived from movie data.
 *
 * Showtimes are absolute instants (the backend serializes `startsAt` to UTC
 * via `toISOString()`). We always render them in the venue's timezone —
 * Honduras (America/Tegucigalpa, UTC-6, no DST) — so the wall-clock the
 * customer sees matches the door.
 */
const VENUE_TZ = "America/Tegucigalpa";

/** "MIÉRCOLES 24 DE JUNIO · 7:00 PM" */
export function formatDateLine(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: VENUE_TZ,
  })
    .format(d)
    .replace(/,/g, "")
    .toUpperCase();

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: VENUE_TZ,
  })
    .format(d)
    .toUpperCase();

  return `${datePart} · ${timePart}`;
}

/** "24.06.2026" — for the header spec line. */
export function formatSpecDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: VENUE_TZ,
  })
    .format(d)
    .replace(/\//g, ".");
}

/** "30 MIN" */
export function formatRuntime(min: number): string {
  return `${min} MIN`;
}

/** "JOSE JAVIER DIAZ · 30 MIN · ES · 2026" */
export function formatFormula(args: {
  director: string;
  runtimeMin: number;
  language: string;
  year: number;
}): string {
  return [
    args.director.toUpperCase(),
    formatRuntime(args.runtimeMin),
    args.language.toUpperCase(),
    String(args.year),
  ].join(" · ");
}

/** "CUATRO · 27.06.2026 · SAN PEDRO SULA" — the header tag line. */
export function formatSpecLine(args: {
  title: string;
  showtimeISO: string;
  venueAddress: string;
}): string {
  return [
    args.title.toUpperCase(),
    formatSpecDate(args.showtimeISO),
    args.venueAddress.toUpperCase(),
  ].join(" · ");
}

/** Hero venue line: "CINEPOLIS ALTARA · SAN PEDRO SULA" */
export function formatVenueLine(args: {
  venueName: string;
  venueAddress: string;
}): string {
  return `${args.venueName.toUpperCase()} · ${args.venueAddress.toUpperCase()}`;
}

/** Footer venue line: "CINEPOLIS ALTARA, SAN PEDRO SULA" */
export function formatVenueAddress(args: {
  venueName: string;
  venueAddress: string;
}): string {
  return `${args.venueName.toUpperCase()}, ${args.venueAddress.toUpperCase()}`;
}

/** A11y label that names the actual film + director. */
export function posterAlt(args: { title: string; director: string }): string {
  return `Cartel del documental ${args.title} de ${args.director}: cara reflectante de un CD sobre fondo nocturno con un destello azul.`;
}
