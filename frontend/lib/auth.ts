/**
 * Auth helpers shared by server components.
 *
 *   getSessionUser()  → fetch GET /api/me, forwarding the incoming session
 *                       cookie. Returns null on 401.
 *   requireUser(next) → wraps getSessionUser; on null, redirects to
 *                       /signin?next=<encoded>.
 *
 * Client-side auth calls live in components that `"use client"` (sign-in form,
 * logout button) and hit the backend directly with `credentials: "include"`.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: "google" | "email";
};

const BACKEND_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

/** Read the current user from the backend, forwarding the inbound cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  try {
    const res = await fetch(`${BACKEND_URL}/api/me`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      cache: "no-store",
    });
    if (res.status === 401 || !res.ok) return null;
    const data = (await res.json()) as { user: SessionUser };
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Read the user's current seat holds, forwarding the inbound cookie. Returns
 * null when the user has no active holds (or isn't signed in / backend down).
 */
export async function getMyHolds(): Promise<{ seatIds: string[]; expiresAt: number } | null> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  try {
    const res = await fetch(`${BACKEND_URL}/api/holds/me`, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as
      | { seatIds: string[]; expiresAt: number }
      | { holds: null };
    if ("holds" in data) return null;
    return data;
  } catch {
    return null;
  }
}

/** Guard a server component — redirects to /signin?next=… when signed out. */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(`/signin?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}
