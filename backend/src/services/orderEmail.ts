import { prisma } from "../db.js";
import { env } from "../env.js";
import { renderQrPng } from "./qrRender.js";
import { sendOrderConfirmation } from "./email.js";

/**
 * Load a paid order's tickets and (re)send the customer confirmation email with
 * inline + attached per-seat QR PNGs to `toEmail`. Shared by the customer resend
 * route and the admin routes. No-op if the order or movie can't be found.
 */
export async function sendConfirmationForOrder(orderCode: string, toEmail: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
  });
  if (!order) return;
  const movie = await prisma.movie.findFirst();
  if (!movie) return;

  const qrAttachments = await Promise.all(
    order.tickets.map(async (t) => ({
      filename: `qr-${t.seat.label}.png`,
      content: await renderQrPng(t.qrPayload),
    })),
  );

  await sendOrderConfirmation({
    to: toEmail,
    props: {
      guestName: order.guestName,
      orderCode: order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: order.totalLps,
      seats: order.tickets.map((t) => ({
        label: t.seat.label,
        qrUrl: `${env.BACKEND_URL}/api/tickets/${order.code}/${encodeURIComponent(t.seat.label)}/qr.png`,
      })),
    },
    qrAttachments,
  });
}
