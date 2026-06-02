"use client";

import { useEffect, useRef, useState } from "react";

const ANNOUNCE_AT = new Set([60, 30]);

export type CountdownState = {
  /** ms remaining; never goes below 0. */
  remainingMs: number;
  /** Whole seconds remaining; never goes below 0. */
  totalSeconds: number;
  /** True when <= 60 seconds remain. */
  warn: boolean;
  /** True when the deadline has passed. */
  expired: boolean;
  /** Latest a11y announcement; clears when consumed. */
  announcement: string;
};

/**
 * Ticks once per second toward `expiresAt` and surfaces:
 *   - remaining ms / seconds for display
 *   - a `warn` flag at <=60s
 *   - an `expired` flag once the deadline passes
 *   - polite a11y announcements at the 60s and 30s thresholds (one-shot each)
 *
 * Self-contained — does not perform redirects. The caller decides what to do
 * on expiry.
 */
export function useCountdown(expiresAt: number | null): CountdownState {
  const [remainingMs, setRemainingMs] = useState(() =>
    expiresAt ? Math.max(0, expiresAt - Date.now()) : 0,
  );
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    announcedRef.current = new Set();
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const next = Math.max(0, expiresAt - Date.now());
      setRemainingMs(next);
      const seconds = Math.ceil(next / 1000);
      if (ANNOUNCE_AT.has(seconds) && !announcedRef.current.has(seconds)) {
        announcedRef.current.add(seconds);
        setAnnouncement(
          seconds >= 60
            ? `Tiempo restante: ${Math.floor(seconds / 60)} minuto.`
            : `Tiempo restante: ${seconds} segundos.`,
        );
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  return {
    remainingMs,
    totalSeconds,
    warn: totalSeconds <= 60 && totalSeconds > 0,
    expired: expiresAt != null && remainingMs <= 0,
    announcement,
  };
}

export function formatMMSS(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
