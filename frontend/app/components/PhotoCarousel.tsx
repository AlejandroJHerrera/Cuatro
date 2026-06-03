"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const PHOTOS: readonly string[] = [
  "/WhatsApp Image 2026-06-02 at 9.19.30 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.20.15 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.20.42 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.21.33 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.22.54 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.23.12 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.32.44 AM.jpeg",
  "/WhatsApp Image 2026-06-02 at 9.39.54 AM.jpeg",
];

const INTERVAL_MS = 4000;

export function PhotoCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setIndex((i) => (i + 1) % PHOTOS.length),
      INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <div
      aria-label="Galería de la Casa de Jose"
      className="
        relative w-full aspect-[4/3]
        overflow-hidden
        border border-ash/30
        bg-curtain
      "
    >
      {PHOTOS.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="(min-width: 768px) 62ch, 100vw"
          priority={i === 0}
          className={`
            object-cover
            transition-opacity duration-1000 ease-out-quart
            ${i === index ? "opacity-100" : "opacity-0"}
          `}
        />
      ))}

      <div
        aria-hidden="true"
        className="
          absolute bottom-3 left-1/2 -translate-x-1/2
          flex items-center gap-1.5
        "
      >
        {PHOTOS.map((_, i) => (
          <span
            key={i}
            className={`
              h-1 w-1 rounded-full
              transition-[background-color,width] duration-500 ease-out-quart
              ${i === index ? "w-4 bg-gold" : "bg-bulb/40"}
            `}
          />
        ))}
      </div>
    </div>
  );
}
