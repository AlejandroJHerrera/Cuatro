import type { Metadata } from "next";
import { getMovie } from "@/lib/movie";
import { getSeats, type Seat } from "@/lib/seats";
import { copy } from "@/lib/copy";
import { getMyHolds, requireUser } from "@/lib/auth";
import { ErrorFallback } from "@/app/components/ErrorFallback";
import { SeatsHeader } from "@/app/components/SeatsHeader";
import { SeatPickerApp } from "@/app/components/SeatPickerApp";

export const metadata: Metadata = {
  title: `${copy.seats.pageTitle} — ${copy.brand.wordmark}`,
};

export default async function SeatsPage() {
  await requireUser("/seats");
  const [movieRes, seatsRes, holds] = await Promise.all([
    getMovie(),
    getSeats(),
    getMyHolds(),
  ]);

  if (!movieRes.ok || !seatsRes.ok) {
    return <ErrorFallback />;
  }

  // Seats the current user already holds come back from /api/seats as "held"
  // (the read path doesn't know whose hold it is). Flip them to "available"
  // so the picker can re-select and the user can edit their own selection.
  const ownedIds = new Set(holds?.seatIds ?? []);
  const seats: Seat[] = ownedIds.size
    ? seatsRes.seats.map((s) =>
        ownedIds.has(s.id) ? { ...s, status: "available" } : s,
      )
    : seatsRes.seats;

  return (
    <main className="relative min-h-screen min-h-[100svh]">
      <SeatsHeader movie={movieRes.movie} />
      <span
        id="contenido"
        aria-hidden="true"
        className="absolute left-0 top-0"
      />
      <SeatPickerApp
        initialSeats={seats}
        initialHolds={holds}
      />
    </main>
  );
}
