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

type OrderDTO = {
  id: string;
  title: string;
  showtimeISO: string;
  venueName: string;
  venueAddress: string;
  seatIds: string[];
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
        return {
          id: o.id,
          title: movie.title,
          showtimeISO: movie.startsAt.toISOString(),
          venueName: movie.venueName,
          venueAddress: movie.venueAddress,
          seatIds,
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
