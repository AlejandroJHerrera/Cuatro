import { requireRole } from "@/lib/auth";
import { ScanClient } from "./ScanClient";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  await requireRole(["doorStaff", "admin"], "/admin/scan");
  return <ScanClient />;
}
