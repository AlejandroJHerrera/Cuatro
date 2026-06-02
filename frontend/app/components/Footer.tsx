import { copy } from "@/lib/copy";

export function Footer({
  formula,
  venueAddress,
}: {
  formula: string;
  venueAddress: string;
}) {
  return (
    <footer
      className="
        flex flex-col items-center bg-hall
        border-t border-ash/20
        px-6 pb-8 pt-16
        sm:px-12 sm:pb-12 sm:pt-32
      "
    >
      <div className="flex w-full max-w-[64rem] flex-col gap-8">
        <p
          className="m-0 font-mono text-[0.8125rem] uppercase text-bulb/70"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {formula}
        </p>
        <p
          className="
            m-0 flex flex-wrap items-center gap-4
            font-body text-xs uppercase text-bulb/75
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          <span className="inline-block">{venueAddress}</span>
          <a
            href={copy.footer.mapHref}
            target="_blank"
            rel="noopener noreferrer"
            className="
              group inline-flex items-center gap-2
              border-b border-ash/40 pb-px text-bulb
              transition-colors duration-200 ease-out-quart
              hover:text-gold hover:border-gold
            "
          >
            {copy.footer.mapLink}
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-200 ease-out-quart group-hover:translate-x-[2px]"
            >
              →
            </span>
          </a>
        </p>
        <hr className="m-0 h-px border-0 bg-ash/20" />
        <p
          className="m-0 font-mono text-[0.6875rem] uppercase text-bulb/40"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.footer.rights}
        </p>
      </div>
    </footer>
  );
}
