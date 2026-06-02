/**
 * GET /api/my-tickets — list of the signed-in user's paid orders, grouped by
 * Order, with the seat labels + movie context the frontend's OrderCard renders.
 * Status is derived ("upcoming" while showtime is in the future, else "past").
 */
import { Router, type Request } from "express";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/routes.js";

export const myTicketsRouter = Router();

type TicketDTO = { seat: string; qrPayload: string };

type OrderDTO = {
  id: string;
  code: string;
  title: string;
  showtimeISO: string;
  venueName: string;
  venueAddress: string;
  seatIds: string[];
  tickets: TicketDTO[];
  status: "upcoming" | "past";
  totalLps: number;
};

myTicketsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = (req.user as User).id;
    const orders = await prisma.order.findMany({
      where: { userId, status: "paid" },
      orderBy: { createdAt: "desc" },
      include: {
        tickets: {
          include: { seat: { select: { label: true, movie: true } } },
        },
      },
    });

    const now = Date.now();
    const dto: OrderDTO[] = orders
      .map((o) => {
        const movie = o.tickets[0]?.seat.movie;
        if (!movie) return null;
        const seatIds = o.tickets
          .map((t) => t.seat.label)
          .sort((a, b) =>
            a[0] === b[0]
              ? Number(a.slice(1)) - Number(b.slice(1))
              : a.localeCompare(b),
          );
        const tickets: TicketDTO[] = o.tickets
          .filter((t) => t.qrPayload)
          .map((t) => ({ seat: t.seat.label, qrPayload: t.qrPayload as string }))
          .sort((a, b) =>
            a.seat[0] === b.seat[0]
              ? Number(a.seat.slice(1)) - Number(b.seat.slice(1))
              : a.seat.localeCompare(b.seat),
          );
        return {
          id: o.id,
          code: o.code,
          title: movie.title,
          showtimeISO: movie.startsAt.toISOString(),
          venueName: movie.venueName,
          venueAddress: movie.venueAddress,
          seatIds,
          tickets,
          status:
            movie.startsAt.getTime() > now
              ? ("upcoming" as const)
              : ("past" as const),
          totalLps: o.totalLps,
        };
      })
      .filter((x): x is OrderDTO => x !== null);

    res.json({ orders: dto });
  } catch (err) {
    next(err);
  }
});
