import { copy } from "@/lib/copy";
import { BACKEND_URL } from "@/lib/api";

/**
 * Google OAuth start link. Ghost button on Hall Black with a monochrome inline
 * glyph; the brand-colored G is deliberately avoided so the button doesn't
 * fight the warm accent.
 *
 * The href points at the eventual backend OAuth start route. Until backend
 * phase 3 lands this will 404 — that's expected. `?next` round-trips through
 * so the callback can land the user where they came from.
 */
export function OAuthButton({ next }: { next: string }) {
  const href = `${BACKEND_URL}/api/auth/google?next=${encodeURIComponent(next)}`;
  return (
    <a
      href={href}
      className="
        group inline-flex items-center justify-center gap-3
        min-h-14 w-full
        px-6 py-3
        font-body font-medium text-sm uppercase
        border border-ash/45 text-bulb bg-transparent
        transition-[color,border-color,background] duration-200 ease-out-quart
        hover:text-gold hover:border-gold
        focus-visible:outline-none
        focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
      "
      style={{ letterSpacing: "var(--tracking-label)" }}
    >
      <GoogleGlyph />
      <span>{copy.signin.googleCta}</span>
    </a>
  );
}

function GoogleGlyph() {
  // Monochrome stylized G — arc + horizontal bar. Reads as Google without
  // borrowing the trademark colors, and inherits the hover→gold transition.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-85 transition-opacity duration-200 ease-out-quart group-hover:opacity-100"
    >
      <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" />
      <path d="M19.5 12H12.5" />
    </svg>
  );
}
