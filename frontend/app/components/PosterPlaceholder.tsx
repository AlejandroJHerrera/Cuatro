/**
 * Pure CSS/SVG placeholder for the album poster.
 *
 * Composition: a deep tinted gradient field anchored slightly off-center,
 * with a single soft warm/blue lens flare in the upper-left quadrant
 * (echoing the album's actual cover) and a subtle disc reflection bottom-right.
 *
 * No nebulae, no stars, no particle fields. The cosmic motif is implied.
 * Real raster poster will replace this via a `<picture>` swap later.
 */
export function PosterPlaceholder({
  ariaLabel,
}: {
  ariaLabel?: string;
}) {
  return (
    <svg
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      viewBox="0 0 1200 1600"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <defs>
        {/* Deep nocturnal field, slightly violet at edges, slightly warmer near center-bottom. */}
        <radialGradient
          id="field"
          cx="35%"
          cy="35%"
          r="95%"
          fx="35%"
          fy="35%"
        >
          <stop offset="0%" stopColor="oklch(0.22 0.04 260)" />
          <stop offset="38%" stopColor="oklch(0.16 0.025 265)" />
          <stop offset="78%" stopColor="oklch(0.115 0.015 270)" />
          <stop offset="100%" stopColor="oklch(0.085 0.01 275)" />
        </radialGradient>

        {/* The single warm-blue lens flare, upper-left. */}
        <radialGradient id="flare" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.82 0.14 245 / 0.55)" />
          <stop offset="35%" stopColor="oklch(0.55 0.16 250 / 0.18)" />
          <stop offset="100%" stopColor="oklch(0.4 0.12 255 / 0)" />
        </radialGradient>

        {/* Disc reflection: low, warm, copper. */}
        <radialGradient id="disc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.78 0.13 75 / 0.35)" />
          <stop offset="55%" stopColor="oklch(0.55 0.09 70 / 0.08)" />
          <stop offset="100%" stopColor="oklch(0.3 0.06 70 / 0)" />
        </radialGradient>

        {/* Subtle film-grain texture via fractal noise, masked to very low opacity. */}
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="4"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0.06 0"
          />
        </filter>
      </defs>

      <rect width="1200" height="1600" fill="url(#field)" />

      {/* Flare ellipse, soft and large. */}
      <ellipse
        cx="280"
        cy="380"
        rx="620"
        ry="420"
        fill="url(#flare)"
        style={{ mixBlendMode: "screen" }}
      />

      {/* Disc reflection, low-right. */}
      <ellipse
        cx="860"
        cy="1180"
        rx="520"
        ry="260"
        fill="url(#disc)"
        style={{ mixBlendMode: "screen" }}
      />

      {/* Grain layer — opacity stays very low so it never reads as noise. */}
      <rect width="1200" height="1600" filter="url(#grain)" opacity="0.5" />
    </svg>
  );
}
