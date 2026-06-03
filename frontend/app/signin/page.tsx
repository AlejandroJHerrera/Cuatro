import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { copy } from "@/lib/copy";
import { getSessionUser } from "@/lib/auth";
import { EmailAuthForm } from "@/app/components/EmailAuthForm";

export const metadata: Metadata = {
  title: `${copy.signin.eyebrow} — ${copy.brand.wordmark}`,
};

type SearchParams = Promise<{ next?: string }>;

const ALLOWED_NEXT = new Set([
  "/",
  "/seats",
  "/checkout",
  "/my-tickets",
  "/success",
]);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { next } = await searchParams;
  // Open-redirect defense: only honor next= when it's one of our own routes.
  // Stripe + OAuth providers will return to fixed callback URLs anyway; this
  // path is only for our own ?next= round-trip.
  const safeNext = sanitizeNext(next);

  // Already signed in? Skip the form.
  const user = await getSessionUser();
  if (user) redirect(safeNext);

  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        grid place-items-center px-6 py-14
      "
    >
      <div className="flex w-full max-w-[28rem] flex-col gap-10">
        {/* Wordmark + eyebrow */}
        <header className="flex flex-col items-center gap-4 text-center">
          <Link
            href="/"
            className="
              font-display font-light uppercase text-bulb
              text-[clamp(2rem,6vw,2.75rem)] leading-[0.95]
              transition-colors duration-200 ease-out-quart
              hover:text-gold
            "
            style={{ letterSpacing: "var(--tracking-marquee)" }}
          >
            {copy.brand.wordmark}
          </Link>
          <span
            className="
              font-mono text-[0.6875rem] uppercase text-bulb/55
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.signin.eyebrow}
          </span>
        </header>

        {/* Card */}
        <section
          aria-labelledby="signin-heading"
          className="
            flex flex-col gap-7
            border border-ash/35
            bg-curtain/40
            px-7 py-9 sm:px-9 sm:py-10
          "
        >
          <h1
            id="signin-heading"
            className="
              m-0 font-display font-light uppercase text-bulb
              text-[clamp(1.5rem,3.5vw,2rem)] leading-[1.05]
            "
            style={{ letterSpacing: "var(--tracking-marquee)" }}
          >
            {copy.signin.heading}
          </h1>
          <p className="m-0 font-body text-sm leading-[1.6] text-bulb/75">
            {copy.signin.body}
          </p>

          <EmailAuthForm next={safeNext} />

          <p
            className="
              m-0 text-center
              font-mono text-[0.625rem] uppercase text-bulb/55
            "
            style={{ letterSpacing: "var(--tracking-label)" }}
          >
            {copy.signin.privacy}
          </p>
        </section>

        <Link
          href="/"
          className="
            self-center font-mono text-[0.6875rem] uppercase text-bulb/65
            border-b border-ash/35 pb-px
            transition-colors duration-200 ease-out-quart
            hover:text-gold hover:border-gold
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.signin.backLink}
        </Link>
      </div>
    </main>
  );
}

function sanitizeNext(raw: string | undefined): string {
  if (!raw) return "/seats";
  // Strip query/fragment for the allow-list lookup; the callback will
  // re-attach what it needs.
  const pathOnly = raw.split("?")[0].split("#")[0];
  return ALLOWED_NEXT.has(pathOnly) ? raw : "/seats";
}
