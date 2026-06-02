import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { renderQrPng } from "../services/qrRender.js";

export const ticketQrRouter = Router();

ticketQrRouter.get("/:code/:seat/qr.png", async (req: Request, res: Response) => {
  const code = req.params.code as string;
  const seat = req.params.seat as string;

  const order = await prisma.order.findUnique({
    where: { code },
    include: { tickets: { include: { seat: true } } },
  });
  if (!order || order.status !== "paid") return res.status(404).end();

  const ticket = order.tickets.find((t) => t.seat.label === seat);
  if (!ticket?.qrPayload) return res.status(404).end();

  const png = await renderQrPng(ticket.qrPayload);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  return res.status(200).end(png);
});
