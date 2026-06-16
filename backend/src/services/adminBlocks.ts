import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { newOrderCode } from "./orders.js";
import { signQrPayload } from "./qrSigning.js";

/**
 * Create an admin "block": an Order with source adminReserved|adminSold and
 * Tickets minted outside the payment flow. Each Ticket gets a signed QR so the
 * seat reads as taken on the public map and scans at the door, exactly like a
 * real sale. totalLps is 0 so admin blocks never count toward public revenue.
 *
 * Throws:
 *   - `missing-seats:<labels>` if any label doesn't exist.
 *   - `seat-conflict:<labels>` if any seat already has a ticket or a live hold.
 */
export async function adminCreateBlock(args: {
  adminId: string;
  seatLabels: string[];
  kind: "reserved" | "sold";
  email: string;
  name?: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const seats = await tx.seat.findMany({
        where: { label: { in: args.seatLabels } },
        include: { ticket: { select: { id: true } }, hold: { select: { expiresAt: true } } },
      });

      const found = new Set(seats.map((s) => s.label));
      const missing = args.seatLabels.filter((l) => !found.has(l));
      if (missing.length) throw new Error(`missing-seats:${missing.join(",")}`);

      const now = Date.now();
      const conflicts = seats
        .filter((s) => s.ticket || (s.hold && s.hold.expiresAt.getTime() > now))
        .map((s) => s.label);
      if (conflicts.length) throw new Error(`seat-conflict:${conflicts.join(",")}`);

      const source = args.kind === "sold" ? "adminSold" : "adminReserved";
      const guestName = args.name && args.name.trim() ? args.name.trim() : "Reservado";

      const order = await tx.order.create({
        data: {
          code: newOrderCode(),
          userId: args.adminId,
          status: "paid",
          source,
          totalLps: 0,
          guestName,
          recipientEmail: args.email,
        },
      });

      const tickets = await Promise.all(
        seats.map((s) =>
          tx.ticket.create({
            data: {
              orderId: order.id,
              seatId: s.id,
              userId: args.adminId,
              qrPayload: signQrPayload(order.code, s.label),
            },
            include: { seat: { select: { label: true } } },
          }),
        ),
      );

      return { order, tickets };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Void an order: delete its tickets + payment receipt (freeing the seats on the
 * public map) and mark the order cancelled (retained for audit). Works on admin
 * blocks and real paid orders (manual-refund path). Idempotent.
 */
export async function releaseOrder(
  code: string,
): Promise<{ ok: true; alreadyCancelled: boolean } | { ok: false; reason: "not-found" }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { code } });
    if (!order) return { ok: false as const, reason: "not-found" as const };
    if (order.status === "cancelled") return { ok: true as const, alreadyCancelled: true };

    await tx.ticket.deleteMany({ where: { orderId: order.id } });
    await tx.paymentReceipt.deleteMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });

    return { ok: true as const, alreadyCancelled: false };
  });
}
