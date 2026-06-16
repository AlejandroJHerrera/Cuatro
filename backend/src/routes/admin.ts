import { Router } from "express";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireRole } from "../auth/requireRole.js";
import { verifyQrPayload } from "../services/qrSigning.js";
import { adminCreateBlock, releaseOrder } from "../services/adminBlocks.js";
import { sendConfirmationForOrder } from "../services/orderEmail.js";

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

adminRouter.post("/blocks", requireRole("admin"), async (req, res) => {
  const { seatLabels, kind, email, name } = req.body as {
    seatLabels?: string[]; kind?: string; email?: string; name?: string;
  };
  if (!Array.isArray(seatLabels) || seatLabels.length === 0) {
    return res.status(400).json({ error: "seatLabels required" });
  }
  if (kind !== "reserved" && kind !== "sold") {
    return res.status(400).json({ error: "kind must be reserved or sold" });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "valid email required" });
  }
  const admin = req.user as { id: string };
  try {
    const { order, tickets } = await adminCreateBlock({ adminId: admin.id, seatLabels, kind, email, name });
    if (env.NODE_ENV !== "test") {
      try {
        await sendConfirmationForOrder(order.code, email);
      } catch (e) {
        console.error(`[email] block ${order.code} failed:`, e);
      }
    }
    return res.status(201).json({
      code: order.code,
      tickets: tickets.map((t) => ({ seat: t.seat.label, qrPayload: t.qrPayload })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("seat-conflict:")) {
      return res.status(409).json({ error: "seat-conflict", conflicts: msg.slice("seat-conflict:".length).split(",") });
    }
    if (msg.startsWith("missing-seats:")) {
      return res.status(404).json({ error: "missing-seats", missing: msg.slice("missing-seats:".length).split(",") });
    }
    throw e;
  }
});

adminRouter.post("/orders/:code/release", requireRole("admin"), async (req, res) => {
  const result = await releaseOrder(req.params.code as string);
  if (!result.ok) return res.status(404).json({ error: "not-found" });
  return res.json({ ok: true, alreadyCancelled: result.alreadyCancelled });
});

adminRouter.post("/orders/:code/resend-email", requireRole("admin"), async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { code: req.params.code as string },
    include: { user: { select: { email: true } } },
  });
  if (!order) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });
  const to = order.recipientEmail ?? order.user.email;
  if (env.NODE_ENV !== "test") {
    try {
      await sendConfirmationForOrder(order.code, to);
    } catch (e) {
      console.error(`[email] admin-resend ${order.code} failed:`, e);
    }
  }
  return res.json({ ok: true });
});

adminRouter.post("/tickets/:id/checkin", requireRole("admin"), async (req, res) => {
  const { redeemed } = req.body as { redeemed?: boolean };
  const id = req.params.id as string;
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).json({ error: "not-found" });
  const admin = req.user as { id: string };

  if (redeemed) {
    if (ticket.redeemedAt) {
      return res.json({ ok: true, redeemedAt: ticket.redeemedAt.toISOString() });
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: { redeemedAt: new Date(), redeemedBy: admin.id },
    });
    return res.json({ ok: true, redeemedAt: updated.redeemedAt!.toISOString() });
  }

  await prisma.ticket.update({ where: { id }, data: { redeemedAt: null, redeemedBy: null } });
  return res.json({ ok: true, redeemedAt: null });
});

adminRouter.get("/door", requireRole("admin"), async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { status: "paid" },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const allTickets = orders.flatMap((o) => o.tickets);
  const scanned = allTickets.filter((t) => t.redeemedAt).length;
  const isPublic = (o: (typeof orders)[number]) => o.source === "customer";
  const soldPublicSeats = orders.filter(isPublic).reduce((n, o) => n + o.tickets.length, 0);
  const compReservedSeats = orders.filter((o) => !isPublic(o)).reduce((n, o) => n + o.tickets.length, 0);
  const publicRevenueLps = orders.filter(isPublic).reduce((n, o) => n + o.totalLps, 0);

  res.json({
    totals: { sold: allTickets.length, scanned, capacity: 121 },
    revenue: { publicRevenueLps, soldPublicSeats, compReservedSeats, scannedSeats: scanned, capacity: 121 },
    orders: orders.map((o) => ({
      code: o.code,
      guestName: o.guestName,
      totalLps: o.totalLps,
      source: o.source,
      tickets: o.tickets.map((t) => ({
        id: t.id,
        seat: t.seat.label,
        redeemedAt: t.redeemedAt?.toISOString() ?? null,
      })),
    })),
  });
});
