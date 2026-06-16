import { requireRole } from "@/lib/auth";
import { getSeats } from "@/lib/seats";
import { ErrorFallback } from "@/app/components/ErrorFallback";
import { AdminSeatsClient } from "./AdminSeatsClient";

export const dynamic = "force-dynamic";

export default async function AdminSeatsPage() {
  await requireRole(["admin"], "/admin/seats");
  const result = await getSeats();
  if (!result.ok) return <ErrorFallback />;
  return <AdminSeatsClient initialSeats={result.seats} />;
}
