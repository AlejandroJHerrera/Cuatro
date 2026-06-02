import { Router } from "express";
import { prisma } from "../db.js";
import { requireRole } from "../auth/requireRole.js";
import { verifyQrPayload } from "../services/qrSigning.js";

export const adminRouter = Router();

adminRouter.post("/scan", requireRole("doorStaff", "admin"), async (req, res) => {
  const { payload } = req.body as { payload?: string };
  if (!payload) {
    res.status(400).json({ ok: false, reason: "missing-payload" });
    return;
  }

  const parsed = verifyQrPayload(payload);
  if (!parsed) {
    res.status(400).json({ ok: false, reason: "invalid" });
    return;
  }

  const ticket = await prisma.ticket.findUnique({
    where: { qrPayload: payload },
    include: {
      seat: { select: { label: true } },
      order: { select: { guestName: true } },
      redeemedByUser: { select: { name: true } },
    },
  });
  if (!ticket) {
    res.status(400).json({ ok: false, reason: "unknown" });
    return;
  }

  if (ticket.redeemedAt) {
    res.json({
      ok: true,
      alreadyUsed: true,
      seat: ticket.seat.label,
      guestName: ticket.order.guestName,
      redeemedAt: ticket.redeemedAt.toISOString(),
      redeemedBy: ticket.redeemedByUser?.name ?? null,
    });
    return;
  }

  const staff = req.user as { id: string };
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { redeemedAt: new Date(), redeemedBy: staff.id },
  });
  res.json({
    ok: true,
    alreadyUsed: false,
    seat: ticket.seat.label,
    guestName: ticket.order.guestName,
    redeemedAt: updated.redeemedAt!.toISOString(),
  });
});

adminRouter.get("/door", requireRole("admin"), async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { status: "paid" },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const total = orders.reduce((n, o) => n + o.tickets.length, 0);
  const scanned = orders.reduce((n, o) => n + o.tickets.filter((t) => t.redeemedAt).length, 0);
  res.json({
    totals: { sold: total, scanned, capacity: 121 },
    orders: orders.map((o) => ({
      code: o.code,
      guestName: o.guestName,
      totalLps: o.totalLps,
      tickets: o.tickets.map((t) => ({
        id: t.id,
        seat: t.seat.label,
        redeemedAt: t.redeemedAt?.toISOString() ?? null,
      })),
    })),
  });
});

adminRouter.post("/manual-checkin", requireRole("admin"), async (req, res) => {
  const { ticketId } = req.body as { ticketId?: string };
  if (!ticketId) {
    res.status(400).json({ error: "ticketId required" });
    return;
  }
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (ticket.redeemedAt) {
    res.json({ ok: true, alreadyUsed: true });
    return;
  }
  const staff = req.user as { id: string };
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { redeemedAt: new Date(), redeemedBy: staff.id },
  });
  res.json({ ok: true, redeemedAt: updated.redeemedAt!.toISOString() });
});
