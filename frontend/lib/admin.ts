import { BACKEND_URL } from "./api";

export type AdminTicket = { seat: string; qrPayload: string };

export type CreateBlockResult =
  | { ok: true; code: string; tickets: AdminTicket[] }
  | { ok: false; reason: "conflict" | "validation" | "auth" | "network"; conflicts?: string[]; message?: string };

export async function createBlock(args: {
  seatLabels: string[];
  kind: "reserved" | "sold";
  email: string;
  name?: string;
}): Promise<CreateBlockResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/blocks`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth" };
    const body = (await res.json().catch(() => ({}))) as {
      code?: string; tickets?: AdminTicket[]; error?: string; conflicts?: string[];
    };
    if (res.ok && body.code && body.tickets) return { ok: true, code: body.code, tickets: body.tickets };
    if (res.status === 409) return { ok: false, reason: "conflict", conflicts: body.conflicts ?? [] };
    if (res.status === 400) return { ok: false, reason: "validation", message: body.error };
    return { ok: false, reason: "network", message: body.error };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function releaseOrder(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/orders/${code}/release`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function toggleCheckin(ticketId: string, redeemed: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/tickets/${ticketId}/checkin`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redeemed }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resendOrderEmail(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/orders/${code}/resend-email`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}
