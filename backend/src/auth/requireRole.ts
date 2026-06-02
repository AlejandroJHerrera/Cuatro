import type { Request, Response, NextFunction } from "express";

type Role = "customer" | "doorStaff" | "admin";

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated?.() || !req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!allowed.includes((req.user as { role: Role }).role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
