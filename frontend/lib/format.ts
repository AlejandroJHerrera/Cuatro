/**
 * Spanish-formatted strings derived from movie data.
 *
 * Showtimes carry their own offset (e.g. "+02:00"). We treat that offset
 * as the venue's local wall-clock and format without further timezone math:
 * rewrite the offset to "Z" and tell Intl to format in UTC.
 */
function asWallClockDate(iso: string): Date {
  return new Date(iso.replace(/(?:Z|[+\-]\d{2}:?\d{2})$/, "Z"));
}

/** "SÁBADO 27 DE JUNIO · 6:00 PM" */
export function formatDateLine(iso: string): string {
  const d = asWallClockDate(iso);
  const datePart = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
    .format(d)
    .replace(/,/g, "")
    .toUpperCase();

  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const timePart = `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;

  return `${datePart} · ${timePart}`;
}

/** "27.06.2026" — for the header spec line. */
export function formatSpecDate(iso: string): string {
  const d = asWallClockDate(iso);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
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
