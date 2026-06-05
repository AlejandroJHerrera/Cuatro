"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SEATS_PER_ORDER,
  type Seat,
  seatLabel,
} from "@/lib/seats";
import { copy } from "@/lib/copy";
import { fetchSeatsClient, releaseHolds, replaceHolds } from "@/lib/holds";
import { SeatGrid } from "./SeatGrid";
import { CartPanel } from "./CartPanel";
import { SeatLegend } from "./SeatLegend";

type Props = {
  initialSeats: Seat[];
  initialHolds: { seatIds: string[]; expiresAt: number } | null;
};

const SYNC_DEBOUNCE_MS = 350;
const POLL_INTERVAL_MS = 5000;

/**
 * Owns selection state, drives the server-side hold via POST /api/holds, and
 * surfaces conflicts when another buyer beats us to a seat. Expiry comes from
 * the server response (20-minute TTL); we tick locally and re-sync on each
 * selection change.
 */
export function SeatPickerApp({ initialSeats, initialHolds }: Props) {
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialHolds?.seatIds ?? []),
  );
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(
    initialHolds?.expiresAt ?? null,
  );
  const [maxNotice, setMaxNotice] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const maxNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncSeqRef = useRef(0); // last-write-wins guard against stale responses
  const pollSeqRef = useRef(0); // last-write-wins guard for poll responses
  const selectedRef = useRef(selected); // latest selection for the poll callback
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const seatsById = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const s of seats) map.set(s.id, s);
    return map;
  }, [seats]);

  const selectedSeats = useMemo(() => {
    const out: Seat[] = [];
    for (const id of selected) {
      const s = seatsById.get(id);
      if (s) out.push(s);
    }
    out.sort((a, b) =>
      a.row === b.row ? a.num - b.num : a.row.localeCompare(b.row),
    );
    return out;
  }, [selected, seatsById]);

  // Expiry tick — flip `expired` once when the deadline passes, then clear
  // selection + server-side holds.
  useEffect(() => {
    if (!holdExpiresAt) return;
    const remaining = holdExpiresAt - Date.now();
    if (remaining <= 0) {
      flushExpired();
      return;
    }
    const t = setTimeout(flushExpired, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdExpiresAt]);

  const flushExpired = useCallback(() => {
    setExpired(true);
    setSelected(new Set());
    setHoldExpiresAt(null);
    void releaseHolds();
    setTimeout(() => setExpired(false), 4000);
  }, []);

  const showMaxNotice = useCallback(() => {
    setMaxNotice(true);
    if (maxNoticeTimerRef.current) clearTimeout(maxNoticeTimerRef.current);
    maxNoticeTimerRef.current = setTimeout(() => setMaxNotice(false), 4000);
  }, []);

  const showConflictNotice = useCallback((message: string) => {
    setConflictNotice(message);
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => setConflictNotice(null), 5000);
  }, []);

  // Debounced sync to the server. Runs after every selection change.
  const syncHolds = useCallback(
    (next: Set<string>) => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      const seq = ++syncSeqRef.current;
      syncTimerRef.current = setTimeout(async () => {
        if (next.size === 0) {
          await releaseHolds();
          if (seq === syncSeqRef.current) setHoldExpiresAt(null);
          return;
        }
        const result = await replaceHolds(Array.from(next));
        if (seq !== syncSeqRef.current) return; // a newer request started
        if (result.ok) {
          setHoldExpiresAt(result.expiresAt);
          return;
        }
        if (result.reason === "conflict" || result.reason === "sold") {
          const lost = new Set(result.conflictSeatIds ?? []);
          // Mark lost seats as held in local state so the grid greys them.
          setSeats((prev) =>
            prev.map((s) => (lost.has(s.id) ? { ...s, status: "held" } : s)),
          );
          // Drop them from selection; keep whatever remains and re-sync.
          setSelected((prev) => {
            const trimmed = new Set<string>();
            for (const id of prev) if (!lost.has(id)) trimmed.add(id);
            // Re-sync the trimmed set so the server reflects what the user still has.
            queueMicrotask(() => syncHolds(trimmed));
            return trimmed;
          });
          showConflictNotice(
            result.message ?? copy.seats.cart.conflictNotice,
          );
          return;
        }
        if (result.reason === "auth") {
          // Session died — push to sign-in. Server holds are gone anyway.
          window.location.href = "/signin?next=/seats";
          return;
        }
        // network / unknown — keep local selection, drop the timer.
        showConflictNotice(copy.seats.cart.conflictNotice);
      }, SYNC_DEBOUNCE_MS);
    },
    [showConflictNotice],
  );

  // Merge a fresh /api/seats snapshot into the grid. The user's own held seats
  // read back as "held" (the DTO can't tell whose hold it is), so we flip the
  // ones in our current selection back to "available" — exactly like the SSR
  // path in app/seats/page.tsx. Any selected seat that is now "taken" was paid
  // for by someone else after our hold lapsed: drop it, re-sync, and notify.
  const reconcileSeats = useCallback(
    (fresh: Seat[]) => {
      const sel = selectedRef.current;
      const freshById = new Map(fresh.map((s) => [s.id, s]));

      setSeats(
        fresh.map((s) =>
          sel.has(s.id) && s.status !== "taken"
            ? { ...s, status: "available" }
            : s,
        ),
      );

      const lost = [...sel].filter(
        (id) => freshById.get(id)?.status === "taken",
      );
      if (lost.length === 0) return;

      const lostSet = new Set(lost);
      const trimmed = new Set([...sel].filter((id) => !lostSet.has(id)));
      setSelected(trimmed);
      void syncHolds(trimmed);

      const labels = lost.map((id) => {
        const s = freshById.get(id);
        return s ? seatLabel(s.row, s.num) : id;
      });
      showConflictNotice(copy.seats.cart.lostSeatNotice(labels));
    },
    [syncHolds, showConflictNotice],
  );

  // Live seat map: poll /api/seats every 5s while the tab is visible. Pause
  // when hidden; refetch immediately on return. Stale responses are dropped.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const seq = ++pollSeqRef.current;
      const fresh = await fetchSeatsClient();
      if (!fresh || seq !== pollSeqRef.current) return;
      reconcileSeats(fresh);
    };

    const start = () => {
      if (interval) return;
      void poll();
      interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reconcileSeats]);

  const toggleSeat = useCallback(
    (seat: Seat) => {
      if (seat.status !== "available") return;
      const id = seat.id;
      const label = seatLabel(seat.row, seat.num);

      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          setAnnouncement(copy.seats.a11y.removed(label));
        } else {
          if (next.size >= MAX_SEATS_PER_ORDER) {
            showMaxNotice();
            return prev;
          }
          next.add(id);
          setAnnouncement(copy.seats.a11y.added(label));
        }
        syncHolds(next);
        return next;
      });
    },
    [showMaxNotice, syncHolds],
  );

  const removeSeat = useCallback(
    (seatId: string) => {
      const seat = seatsById.get(seatId);
      if (seat) toggleSeat(seat);
    },
    [seatsById, toggleSeat],
  );

  useEffect(() => {
    return () => {
      if (maxNoticeTimerRef.current) clearTimeout(maxNoticeTimerRef.current);
      if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  return (
    <div
      className="
        relative w-full
        grid grid-cols-1 lg:grid-cols-[1fr_22rem]
        gap-x-12 gap-y-8
        px-6 pb-40 pt-8
        sm:px-12
        lg:px-16 lg:pb-16 lg:pt-12
      "
    >
      <span
        aria-live="polite"
        aria-atomic="true"
        className="sr-only absolute"
      >
        {announcement}
      </span>

      <div className="flex flex-col gap-8 min-w-0">
        <SeatGrid seats={seats} selected={selected} onToggle={toggleSeat} />
        <SeatLegend />
      </div>

      <CartPanel
        selectedSeats={selectedSeats}
        onRemove={removeSeat}
        holdExpiresAt={holdExpiresAt}
        maxNotice={maxNotice}
        expired={expired}
        conflictNotice={conflictNotice}
      />
    </div>
  );
}
