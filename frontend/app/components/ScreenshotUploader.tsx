"use client";
import { useRef, useState } from "react";
import { copy } from "@/lib/copy";

export function ScreenshotUploader({
  onSubmit,
  busy,
  retryLabel,
}: {
  onSubmit: (file: File) => void;
  busy: boolean;
  retryLabel?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpeg"].includes(f.type)) {
      setError(copy.checkout.upload.wrongType);
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError(copy.checkout.upload.tooLarge);
      return;
    }
    setError(null);
    setFile(f);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span
          className="font-mono text-[0.6875rem] uppercase text-bulb/55"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {retryLabel ? copy.checkout.upload.pickAnother : copy.checkout.upload.label}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={pick}
          disabled={busy}
          className="block text-sm text-bulb file:mr-3 file:border-0 file:bg-ash/30 file:text-bulb file:px-3 file:py-2 file:font-mono file:text-[0.6875rem] file:uppercase hover:file:bg-ash/45"
        />
      </label>
      {file && (
        <p
          className="m-0 font-mono text-[0.6875rem] uppercase text-bulb/65"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {file.name} · {(file.size / 1024).toFixed(0)} KB
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-gold">{error}</p>
      )}
      <button
        type="button"
        disabled={!file || busy}
        onClick={() => file && onSubmit(file)}
        className="
          inline-flex items-center justify-center
          min-h-14 w-full px-6 py-3
          font-body font-medium text-base uppercase
          bg-gold text-hall border border-gold
          transition-[background,opacity] duration-200 ease-out-quart
          hover:bg-gold-deep
          disabled:opacity-50 disabled:cursor-not-allowed
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.checkout.upload.cta} →
      </button>
    </div>
  );
}
