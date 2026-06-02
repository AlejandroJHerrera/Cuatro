import { customAlphabet } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newOrderCode = customAlphabet(ORDER_CODE_ALPHABET, 6);

export async function findOrCreatePendingOrder(args: {
  userId: string;
  totalLps: number;
  guestName: string;
}) {
  const existing = await prisma.order.findFirst({
    where: { userId: args.userId, status: "pending" },
  });
  if (existing) return existing;

  return prisma.order.create({
    data: {
      code: newOrderCode(),
      userId: args.userId,
      status: "pending",
      totalLps: args.totalLps,
      guestName: args.guestName,
    },
  });
}

export async function incrementOrderAttempts(orderId: string, reason: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { verificationAttempts: { increment: 1 }, rejectionReason: reason },
  });
}

export async function finalizeOrderAsPaid(args: {
  orderId: string;
  userId: string;
  qrPayloadFor: (seatLabel: string) => string;
  txnId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const dup = await tx.paymentReceipt.findUnique({ where: { txnId: args.txnId } });
    if (dup) throw new Error(`duplicate-txn-id:${args.txnId}`);

    const holds = await tx.seatHold.findMany({
      where: { userId: args.userId, expiresAt: { gt: new Date() } },
      include: { seat: { select: { id: true, label: true } } },
    });
    if (holds.length === 0) throw new Error("no-active-holds");

    const tickets = await Promise.all(
      holds.map((h) =>
        tx.ticket.create({
          data: {
            orderId: args.orderId,
            seatId: h.seat.id,
            userId: args.userId,
            qrPayload: args.qrPayloadFor(h.seat.label),
          },
          include: { seat: { select: { label: true } } },
        }),
      ),
    );

    await tx.seatHold.deleteMany({ where: { userId: args.userId } });

    await tx.paymentReceipt.create({
      data: { orderId: args.orderId, txnId: args.txnId },
    });

    const order = await tx.order.update({
      where: { id: args.orderId },
      data: { status: "paid", verifiedAt: new Date(), rejectionReason: null },
    });

    return { order, tickets };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
