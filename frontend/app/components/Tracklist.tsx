import { copy } from "@/lib/copy";

export function Tracklist() {
  return (
    <section
      aria-labelledby="tracklist-label"
      className="
        flex flex-col items-center bg-hall
        px-6 pb-32 pt-16
        sm:px-12 sm:pb-40 sm:pt-24
      "
    >
      <div className="flex w-full max-w-[64rem] flex-col gap-8">
        <span
          id="tracklist-label"
          className="
            block border-t-2 border-ash/50 pt-4
            font-mono text-xs uppercase text-bulb/55
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.tracklist.sectionLabel}
        </span>
        <ol className="m-0 flex flex-col p-0 list-none">
          {copy.tracklist.rows.map((row) => (
            <li
              key={row.n}
              className="
                grid items-baseline gap-4
                [grid-template-columns:2.5em_1fr_auto]
                sm:[grid-template-columns:3em_1fr_auto]
                py-4 sm:py-8
                border-b border-ash/30
                transition-colors duration-[400ms] ease-out-quart
                hover:border-bulb/45
              "
            >
              <span
                aria-hidden="true"
                className="
                  font-mono text-[0.8125rem] text-bulb/50
                  [font-variant-numeric:tabular-nums]
                "
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                {row.n}
              </span>
              <span
                className="
                  font-display font-normal uppercase
                  text-bulb leading-[1.05]
                  text-[clamp(1.25rem,3vw,2rem)]
                "
                style={{ letterSpacing: "0.03em" }}
              >
                {row.title}
              </span>
              <span
                aria-label={`Duración ${row.duration}`}
                className="
                  justify-self-end
                  font-mono text-[0.8125rem] text-bulb/65
                  [font-variant-numeric:tabular-nums]
                  [letter-spacing:0.05em]
                "
              >
                {row.duration}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
