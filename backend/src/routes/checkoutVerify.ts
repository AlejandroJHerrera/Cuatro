import { Router, type Request, type Response } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../auth/routes.js";
import { signQrPayload } from "../services/qrSigning.js";
import { renderQrPng } from "../services/qrRender.js";
import { finalizeOrderAsPaid, findOrCreatePendingOrder, incrementOrderAttempts } from "../services/orders.js";
import { releaseUserHolds } from "../services/holds.js";
import { type PaymentVerifier, type VerifyVerdict } from "../services/paymentVerifier.js";
import { sendOrderConfirmation, sendOrderRejection, sendPaymentArchive } from "../services/email.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") cb(null, true);
    else cb(new Error("unsupported-mime"));
  },
});

const SOFT_CAP_MS = 30_000;
const MAX_ATTEMPTS = 3;

export type Mailer = {
  confirmation: typeof sendOrderConfirmation;
  archive: typeof sendPaymentArchive;
  rejection: typeof sendOrderRejection;
};

const defaultMailer: Mailer = {
  confirmation: sendOrderConfirmation,
  archive: sendPaymentArchive,
  rejection: sendOrderRejection,
};

export function checkoutVerifyRouter(opts: { verifier: PaymentVerifier; mailer?: Mailer }) {
  const router = Router();
  const mailer = opts.mailer ?? defaultMailer;

  router.post("/verify", requireAuth, upload.single("screenshot"), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "screenshot required" });
    const user = req.user as { id: string; email: string; name: string | null };

    const holds = await prisma.seatHold.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      include: { seat: { include: { movie: true } } },
    });
    const firstHold = holds[0];
    if (!firstHold) return res.status(410).json({ status: "holds-expired" });

    const movie = firstHold.seat.movie;
    const totalLps = movie.priceLps * holds.length;

    const order = await findOrCreatePendingOrder({
      userId: user.id,
      totalLps,
      guestName: user.name ?? user.email,
    });

    if (order.verificationAttempts >= MAX_ATTEMPTS) {
      await releaseUserHolds(user.id);
      return res.status(410).json({ status: "attempts-exhausted" });
    }

    const verifyPromise = opts.verifier.verify({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype as "image/png" | "image/jpeg",
      expected: {
        amountLps: totalLps,
        accountRef: env.BANK_ACCOUNT_REF,
        orderCode: order.code,
        holdCreatedAt: firstHold.createdAt,
      },
    });

    let verdictOrTimeout: VerifyVerdict | "timeout";
    try {
      verdictOrTimeout = await Promise.race<VerifyVerdict | "timeout">([
        verifyPromise,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SOFT_CAP_MS)),
      ]);
    } catch {
      verdictOrTimeout = { ok: false, reason: "unreadable", detail: "No pudimos leer el comprobante." };
    }

    const seatLabels = holds.map((h) => h.seat.label);

    if (verdictOrTimeout === "timeout") {
      const screenshotCopy = { buffer: Buffer.from(req.file.buffer), mimeType: req.file.mimetype, filename: req.file.originalname };
      verifyPromise
        .then((v) =>
          applyVerdictAsync({ verdict: v, user, order, totalLps, seats: seatLabels, screenshotCopy, mailer }),
        )
        .catch(async () => {
          await incrementOrderAttempts(order.id, "unreadable");
        });
      return res.status(202).json({ status: "pending" });
    }

    return applyVerdictAndRespond({
      verdict: verdictOrTimeout,
      user,
      order,
      totalLps,
      seats: seatLabels,
      screenshotCopy: { buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname },
      mailer,
      res,
    });
  });

  return router;
}

async function applyVerdictAndRespond(args: {
  verdict: VerifyVerdict;
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  screenshotCopy: { buffer: Buffer; mimeType: string; filename: string };
  mailer: Mailer;
  res: Response;
}) {
  if (args.verdict.ok) {
    try {
      await finalizeAndEmail({ ...args, txnId: args.verdict.txnId });
      return args.res.status(200).json({ status: "approved", orderCode: args.order.code });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("duplicate-txn-id")) {
        await incrementOrderAttempts(args.order.id, "duplicate-receipt");
        await args.mailer.archive({
          props: archiveProps({ ...args, verdict: { ok: false, reason: "missing-txn-id", detail: "Comprobante reutilizado." } }),
          screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
        });
        const updated = await prisma.order.findUnique({ where: { id: args.order.id } });
        return args.res.status(422).json({
          status: "rejected",
          reason: "duplicate-receipt",
          detail: "Comprobante ya usado.",
          attemptsLeft: Math.max(MAX_ATTEMPTS - (updated?.verificationAttempts ?? MAX_ATTEMPTS), 0),
        });
      }
      throw e;
    }
  }
  await incrementOrderAttempts(args.order.id, args.verdict.reason);
  await args.mailer.archive({
    props: archiveProps({ ...args, verdict: args.verdict }),
    screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
  });
  const updated = await prisma.order.findUnique({ where: { id: args.order.id } });
  return args.res.status(422).json({
    status: "rejected",
    reason: args.verdict.reason,
    detail: args.verdict.detail,
    attemptsLeft: Math.max(MAX_ATTEMPTS - (updated?.verificationAttempts ?? MAX_ATTEMPTS), 0),
  });
}

async function applyVerdictAsync(args: {
  verdict: VerifyVerdict;
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  screenshotCopy: { buffer: Buffer; mimeType: string; filename: string };
  mailer: Mailer;
}) {
  if (args.verdict.ok) {
    await finalizeAndEmail({ ...args, txnId: args.verdict.txnId });
    return;
  }
  await incrementOrderAttempts(args.order.id, args.verdict.reason);
  await args.mailer.archive({
    props: archiveProps({ ...args, verdict: args.verdict }),
    screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
  });
  await args.mailer.rejection({
    to: args.user.email,
    props: {
      guestName: args.user.name ?? "amigo",
      orderCode: args.order.code,
      detail: args.verdict.detail,
      retryUrl: `${env.FRONTEND_URL}/checkout?retry=${args.order.code}`,
    },
  });
}

async function finalizeAndEmail(args: {
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  txnId: string;
  mailer: Mailer;
}) {
  const finalized = await finalizeOrderAsPaid({
    orderId: args.order.id,
    userId: args.user.id,
    qrPayloadFor: (label) => signQrPayload(args.order.code, label),
    txnId: args.txnId,
  });

  const movie = (await prisma.movie.findFirst())!;
  const qrAttachments = await Promise.all(
    finalized.tickets.map(async (t) => {
      const png = await renderQrPng(t.qrPayload!);
      return { filename: `qr-${t.seat.label}.png`, content: png, cid: `qr-${t.seat.label}` };
    }),
  );

  await args.mailer.confirmation({
    to: args.user.email,
    props: {
      guestName: args.user.name ?? "amigo",
      orderCode: args.order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: args.totalLps,
      seats: finalized.tickets.map((t) => ({ label: t.seat.label, qrCid: `qr-${t.seat.label}` })),
    },
    qrAttachments,
  });

  await args.mailer.archive({
    props: {
      orderCode: args.order.code,
      guestName: args.user.name ?? args.user.email,
      email: args.user.email,
      amountLps: args.totalLps,
      seats: args.seats,
      verdict: "approved",
      txnId: args.txnId,
    },
  });
}

function archiveProps(args: {
  user: { email: string; name: string | null };
  order: { code: string };
  totalLps: number;
  seats: string[];
  verdict: VerifyVerdict;
}) {
  if (args.verdict.ok) {
    return {
      orderCode: args.order.code,
      guestName: args.user.name ?? args.user.email,
      email: args.user.email,
      amountLps: args.totalLps,
      seats: args.seats,
      verdict: "approved" as const,
      txnId: args.verdict.txnId,
    };
  }
  return {
    orderCode: args.order.code,
    guestName: args.user.name ?? args.user.email,
    email: args.user.email,
    amountLps: args.totalLps,
    seats: args.seats,
    verdict: "rejected" as const,
    reason: args.verdict.reason,
    detail: args.verdict.detail,
  };
}
