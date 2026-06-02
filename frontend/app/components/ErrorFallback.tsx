"use client";

import { copy } from "@/lib/copy";

export function ErrorFallback() {
  return (
    <section
      className="
        grid min-h-screen min-h-[100svh] place-items-center
        bg-hall px-6 py-16
      "
    >
      <div className="flex max-w-md flex-col items-center gap-8 text-center">
        <h1
          className="
            m-0 font-display font-light uppercase text-bulb
            text-[clamp(2.5rem,8vw,5rem)]
          "
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {copy.brand.wordmark}
        </h1>
        <p
          role="alert"
          className="m-0 max-w-[38ch] text-base leading-[1.55] text-bulb/80"
        >
          {copy.states.error.body}
        </p>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="
            inline-flex items-center justify-center
            border border-ash/60 bg-transparent
            px-9 py-4
            font-body font-medium text-xs uppercase text-bulb
            transition-colors duration-200 ease-out-quart
            hover:border-gold hover:text-gold
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.states.error.retry}
        </button>
      </div>
    </section>
  );
}
