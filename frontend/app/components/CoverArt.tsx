import Image from "next/image";

type Props = {
  alt: string;
};

/**
 * Hero cover art layer — just the CD, floating against Hall Black.
 *
 * The source JPG includes a starfield + Earth horizon + warm flare that we
 * deliberately discard with a radial CSS mask. The disc in the source image
 * is centered near (52%, 50%) and occupies ~38% of the frame radius; the
 * mask keeps that circle opaque and feathers everything outside it into
 * transparent so the page background shows through cleanly.
 *
 * Two layouts:
 *   - mobile: disc centered behind the title, scaled down so the lower-third
 *     copy clears it.
 *   - sm+: disc right-anchored, vertically centered, sized to read as an
 *     object in the room rather than a wallpapered photo.
 *
 * File: /public/cover.jpg.
 */
export function CoverArt({ alt }: Props) {
  // Radial mask shared by both layouts. `at 52% 50%` is the CD center in the
  // source image; 47% holds the full disc edge crisp, then a 5-pt feather
  // dissolves the surrounding starfield into the page background.
  const discMask =
    "radial-gradient(circle at 52% 50%, #000 0%, #000 47%, transparent 52%)";
  const maskStyle: React.CSSProperties = {
    maskImage: discMask,
    WebkitMaskImage: discMask,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
  };

  return (
    <>
      {/* Mobile: disc centered, scaled to ~85% of viewport width. */}
      <div
        className="
          absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2
          w-[88vw] aspect-square sm:hidden
        "
        style={maskStyle}
      >
        <Image
          src="/cover.jpg"
          alt={alt}
          fill
          priority
          sizes="88vw"
          className="object-cover"
        />
      </div>

      {/* sm+: disc anchored right, vertically centered. Square aspect-ratio
          box sized off viewport height keeps the CD a consistent visual
          object regardless of viewport width. */}
      <div
        className="
          absolute hidden sm:block
          top-1/2 -translate-y-1/2
          right-[-6vw] md:right-[-4vw] lg:right-[-2vw]
          h-[92vh] aspect-square max-h-[60rem]
        "
        style={maskStyle}
      >
        <Image
          src="/cover.jpg"
          alt={alt}
          fill
          priority
          sizes="(min-width: 1280px) 60vh, (min-width: 768px) 70vh, 80vh"
          className="object-cover"
        />
      </div>
    </>
  );
}
