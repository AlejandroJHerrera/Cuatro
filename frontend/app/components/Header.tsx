import { copy } from "@/lib/copy";

export function Header({ specLine }: { specLine: string }) {
  return (
    <header
      className="
        absolute inset-x-0 top-0 z-30
        flex items-center justify-between
        px-4 py-4 sm:px-8
        font-mono text-xs uppercase
        text-bulb/80
      "
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      <span
        aria-hidden="true"
        className="hidden sm:inline-block max-w-[60vw] truncate"
      >
        {specLine}
      </span>
      <a
        href="/my-tickets"
        className="
          group inline-flex items-center gap-2
          text-bulb transition-colors duration-200 ease-out-quart
          hover:text-gold
          ml-auto
        "
      >
        {copy.header.myTickets}
        <span
          aria-hidden="true"
          className="inline-block transition-transform duration-200 ease-out-quart group-hover:translate-x-[2px]"
        >
          →
        </span>
      </a>
    </header>
  );
}
