import { copy } from "@/lib/copy";

export function ProgrammerNote() {
  return (
    <section
      aria-labelledby="programmer-note-label"
      className="
        flex flex-col items-center bg-hall
        px-6 py-32 sm:px-12 sm:py-40 lg:py-48
      "
    >
      <div className="flex w-full max-w-[62ch] flex-col gap-8">
        <span
          id="programmer-note-label"
          className="
            inline-flex items-center gap-3
            font-mono text-xs uppercase text-bulb/55
            after:block after:h-px after:max-w-[6em] after:flex-1
            after:bg-ash/45 after:content-['']
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.note.sectionLabel}
        </span>
        <p
          className="
            drop-cap m-0
            font-body text-base sm:text-lg
            leading-[1.65]
            text-bulb/95
            [letter-spacing:0.005em]
          "
        >
          {copy.note.body}
        </p>
      </div>
    </section>
  );
}
