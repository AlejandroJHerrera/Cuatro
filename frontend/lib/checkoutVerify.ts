import { BACKEND_URL } from "./api";

export type VerifyResult =
  | { status: "approved"; orderCode: string }
  | { status: "rejected"; reason: string; detail: string; attemptsLeft: number }
  | { status: "pending" }
  | { status: "attempts-exhausted" }
  | { status: "holds-expired" }
  | { status: "network-error" };

export async function submitScreenshot(file: File): Promise<VerifyResult> {
  const fd = new FormData();
  fd.append("screenshot", file);
  try {
    const res = await fetch(`${BACKEND_URL}/api/checkout/verify`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) return { status: "approved", orderCode: body.orderCode };
    if (res.status === 202) return { status: "pending" };
    if (res.status === 410 && body.status === "attempts-exhausted") return { status: "attempts-exhausted" };
    if (res.status === 410) return { status: "holds-expired" };
    if (res.status === 422) return { status: "rejected", reason: body.reason, detail: body.detail, attemptsLeft: body.attemptsLeft };
    return { status: "network-error" };
  } catch {
    return { status: "network-error" };
  }
}
