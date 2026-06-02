/**
 * Stripe Checkout session creation.
 *
 * Flow:
 *   1. Look up the user's active holds (must have ≥1; we re-validate they
 *      aren't expired before charging).
 *   2. Insert Order(status=pending) with a fresh nanoid code + totalLps.
 *   3. Create a Stripe Checkout Session with metadata that the webhook
 *      (phase 6) will use to mark the order paid + convert holds → tickets.
 *   4. Persist the stripeSessionId on the Order.
 *
 * The seat→ticket conversion happens in the webhook handler, not here, so a
 * user who bails mid-payment can't accidentally end up with tickets.
 */
import Stripe from "stripe";
import { customAlphabet } from "nanoid";
import { prisma } from "../db.js";
import { env } from "../env.js";

// 32 unambiguous chars (no 0/O/1/I) × 6 → enough headroom for thousands of orders.
const orderCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

let stripeClient: Stripe | null = null;
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
      // Pin a stable API version so silent surprises don't break us.
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return stripeClient;
}

export type CheckoutResult =
  | { ok: true; url: string; orderCode: string }
  | {
      ok: false;
      reason:
        | "no-holds"
        | "expired-holds"
        | "no-movie"
        | "stripe-not-configured"
        | "stripe-failed";
      message?: string;
    };

export async function createCheckoutSession(
  userId: string,
  userName: string | null,
  userEmail: string,
): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, reason: "stripe-not-configured" };
  }

  const holds = await prisma.seatHold.findMany({
    where: { userId },
    include: { seat: { include: { movie: true } } },
  });
  if (holds.length === 0) {
    return { ok: false, reason: "no-holds" };
  }
  const now = Date.now();
  if (holds.some((h) => h.expiresAt.getTime() <= now)) {
    return { ok: false, reason: "expired-holds" };
  }
  const movie = holds[0]?.seat.movie;
  if (!movie) {
    return { ok: false, reason: "no-movie" };
  }

  const seatLabels = holds
    .map((h) => h.seat.label)
    .sort((a, b) =>
      a[0] === b[0]
        ? Number(a.slice(1)) - Number(b.slice(1))
        : a.localeCompare(b),
    );
  const totalLps = holds.length * movie.priceLps;
  const code = orderCode();

  const order = await prisma.order.create({
    data: {
      code,
      userId,
      status: "pending",
      totalLps,
      guestName: userName ?? userEmail,
    },
  });

  // success_url + cancel_url carry the data the existing frontend pages read
  // off the query string (/success?seats=…&order=…  /cancel?seats=…&expires=…).
  const seatsParam = encodeURIComponent(seatLabels.join(","));
  const successUrl = `${env.FRONTEND_URL}/success?seats=${seatsParam}&order=${code}`;
  const earliestHoldExpiry = Math.min(...holds.map((h) => h.expiresAt.getTime()));
  const cancelUrl = `${env.FRONTEND_URL}/cancel?seats=${seatsParam}&expires=${earliestHoldExpiry}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: userEmail,
      line_items: [
        {
          quantity: holds.length,
          price_data: {
            // Stripe doesn't accept HNL across all accounts; use USD for test mode.
            // Display labels stay in LPS on the frontend; refine in a later pass
            // once we confirm currency support for the live account.
            currency: "usd",
            unit_amount: movie.priceLps * 100, // cents
            product_data: {
              name: `${movie.title} — Butaca`,
              description: `Función ${movie.startsAt.toISOString().slice(0, 10)} · ${seatLabels.join(", ")}`,
            },
          },
        },
      ],
      metadata: {
        orderId: order.id,
        orderCode: code,
        userId,
        seatLabels: seatLabels.join(","),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // 30 minute window — comfortably outside the 10-min hold window.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    if (!session.url) {
      return { ok: false, reason: "stripe-failed", message: "Stripe session has no URL." };
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    });

    return { ok: true, url: session.url, orderCode: code };
  } catch (err) {
    console.error("Stripe session creation failed:", err);
    // Roll the pending order back so retries don't pile up dead rows.
    await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Stripe error.";
    return { ok: false, reason: "stripe-failed", message };
  }
}
