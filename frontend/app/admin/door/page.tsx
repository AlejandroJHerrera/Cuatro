import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { DoorClient, type Door } from "./DoorClient";
import { ErrorFallback } from "@/app/components/ErrorFallback";

export const dynamic = "force-dynamic";

const SERVER_API = process.env.API_URL ?? "http://localhost:4000";

export default async function DoorPage() {
  await requireRole(["admin"], "/admin/door");
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const res = await fetch(`${SERVER_API}/api/admin/door`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    cache: "no-store",
  });
  if (!res.ok) return <ErrorFallback />;
  const data = (await res.json()) as Door;
  return <DoorClient initial={data} />;
}
