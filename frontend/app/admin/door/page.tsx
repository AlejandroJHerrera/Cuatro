import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/api";
import { DoorClient, type Door } from "./DoorClient";
import { ErrorFallback } from "@/app/components/ErrorFallback";

export const dynamic = "force-dynamic";

export default async function DoorPage() {
  await requireRole(["admin"], "/admin/door");
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const res = await fetch(`${BACKEND_URL}/api/admin/door`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    cache: "no-store",
  });
  if (!res.ok) return <ErrorFallback />;
  const data = (await res.json()) as Door;
  return <DoorClient initial={data} />;
}
