/**
 * POST /api/checkout — create a Stripe Checkout Session for the user's active
 * holds. Returns `{ url }` for the browser to redirect to.
 */
import { Router, type Request } from "express";
import type { User } from "@prisma/client";
import { requireAuth } from "../auth/routes.js";
import { createCheckoutSession } from "../services/checkout.js";

export const checkoutRouter = Router();

checkoutRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const user = req.user as User;
    const result = await createCheckoutSession(user.id, user.name, user.email);
    if (result.ok) {
      res.json({ url: result.url, orderCode: result.orderCode });
      return;
    }
    switch (result.reason) {
      case "stripe-not-configured":
        res.status(503).json({ error: "El pago no está configurado." });
        return;
      case "no-holds":
        res.status(400).json({ error: "No tienes butacas reservadas." });
        return;
      case "expired-holds":
        res.status(410).json({ error: "Tu reserva ha caducado. Elige tus butacas de nuevo." });
        return;
      case "no-movie":
        res.status(404).json({ error: "No movie configured." });
        return;
      case "stripe-failed":
        res.status(502).json({ error: result.message ?? "Stripe falló." });
        return;
    }
  } catch (err) {
    next(err);
  }
});
