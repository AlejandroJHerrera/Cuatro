import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { findOrCreatePendingOrder } from "../services/orders.js";
import { sendConfirmationForOrder } from "../services/orderEmail.js";

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
  const order = await prisma.order.findUnique({ where: { code } });
  if (!order || order.userId !== user.id) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });

  await sendConfirmationForOrder(order.code, user.email);
  return res.json({ ok: true });
});
