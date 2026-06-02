import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { renderQrPng } from "../services/qrRender.js";
import { sendOrderConfirmation } from "../services/email.js";
import { findOrCreatePendingOrder } from "../services/orders.js";

export const ordersRouter = Router();

ordersRouter.post("/pending", requireAuth, async (req, res) => {
  const { totalLps, guestName } = req.body as { totalLps?: number; guestName?: string };
  if (typeof totalLps !== "number" || !guestName) {
    return res.status(400).json({ error: "totalLps + guestName required" });
  }
  const user = req.user as { id: string };
  const order = await findOrCreatePendingOrder({ userId: user.id, totalLps, guestName });
  res.json({ code: order.code });
});

ordersRouter.post("/:code/resend-email", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string; name: string | null };
  const code = req.params.code as string;
  const order = await prisma.order.findUnique({
    where: { code },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
  });
  if (!order || order.userId !== user.id) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });

  const movie = await prisma.movie.findFirst();
  if (!movie) return res.status(500).json({ error: "no-movie" });

  const attachments = await Promise.all(
    order.tickets.map(async (t) => ({
      filename: `qr-${t.seat.label}.png`,
      content: await renderQrPng(t.qrPayload!),
      cid: `qr-${t.seat.label}`,
    })),
  );

  await sendOrderConfirmation({
    to: user.email,
    props: {
      guestName: user.name ?? "amigo",
      orderCode: order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: order.totalLps,
      seats: order.tickets.map((t) => ({ label: t.seat.label, qrCid: `qr-${t.seat.label}` })),
    },
    qrAttachments: attachments,
  });

  return res.json({ ok: true });
});
