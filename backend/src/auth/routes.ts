/**
 * Auth endpoints:
 *   GET  /api/auth/google             — start OAuth
 *   GET  /api/auth/google/callback    — finish OAuth, redirect to `?next` (sanitized)
 *   POST /api/auth/signup             — email/password sign-up
 *   POST /api/auth/signin             — email/password sign-in
 *   POST /api/auth/logout             — destroy session
 *   GET  /api/me                      — current user or 401
 *
 * The frontend already calls /api/auth/google?next=… and POSTs to signin/signup.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthProvider, type User } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { passport, googleStrategyConfigured } from "./passport.js";

export const authRouter = Router();

// "next" is only safe if it's a relative path on our frontend. Reject absolute
// URLs, protocol-relative paths, and anything that doesn't start with a single "/".
function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    provider: u.provider,
    role: u.role,
  };
}

// ─── Google OAuth ────────────────────────────────────────────────────────────

authRouter.get("/auth/google", (req, res, next) => {
  if (!googleStrategyConfigured) {
    res.status(503).json({ error: "Google sign-in is not configured." });
    return;
  }
  // Stash `next` in the session so the callback can read it.
  (req.session as unknown as { authNext?: string }).authNext = safeNext(req.query.next);
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

authRouter.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!googleStrategyConfigured) {
      res.status(503).json({ error: "Google sign-in is not configured." });
      return;
    }
    passport.authenticate("google", { failureRedirect: `${env.FRONTEND_URL}/signin?error=google` })(
      req,
      res,
      next,
    );
  },
  (req, res) => {
    const next = (req.session as unknown as { authNext?: string }).authNext ?? "/";
    delete (req.session as unknown as { authNext?: string }).authNext;
    res.redirect(`${env.FRONTEND_URL}${next}`);
  },
);

// ─── Email + password ────────────────────────────────────────────────────────

const signupSchema = z.object({
  name: z.string().trim().min(1, "Tu nombre es requerido.").max(120),
  email: z.string().trim().toLowerCase().email("Correo inválido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
});

const signinSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido."),
  password: z.string().min(1).max(200),
});

function loginSession(req: Request, user: User): Promise<void> {
  return new Promise((resolve, reject) => {
    req.login(user, (err) => (err ? reject(err) : resolve()));
  });
}

authRouter.post("/auth/signup", async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." });
      return;
    }
    const { name, email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Esa cuenta ya existe. Inicia sesión." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        provider: AuthProvider.email,
        passwordHash,
      },
    });

    await loginSession(req, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/auth/signin", async (req, res, next) => {
  try {
    const parsed = signinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos." });
      return;
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // Either no account or it was created via Google — same error to avoid leaking.
      res.status(401).json({ error: "Correo o contraseña incorrectos." });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Correo o contraseña incorrectos." });
      return;
    }
    await loginSession(req, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/auth/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie("cuatro.sid");
      res.json({ ok: true });
    });
  });
});

// ─── /api/me ────────────────────────────────────────────────────────────────

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  res.json({ user: publicUser(req.user as User) });
});

// Auth middleware available for later phases.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }
  next();
}
