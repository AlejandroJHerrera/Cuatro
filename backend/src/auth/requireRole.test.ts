import { test, expect, vi } from "vitest";
import { requireRole } from "./requireRole.js";

function buildReqRes(user: any) {
  return {
    req: { user, isAuthenticated: () => !!user } as any,
    res: { status: vi.fn().mockReturnThis(), json: vi.fn() } as any,
    next: vi.fn(),
  };
}

test("401 when unauthenticated", () => {
  const mw = requireRole("admin");
  const { req, res, next } = buildReqRes(null);
  mw(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test("403 when role mismatch", () => {
  const mw = requireRole("admin");
  const { req, res, next } = buildReqRes({ id: "1", role: "customer" });
  mw(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test("next() when role matches", () => {
  const mw = requireRole("admin", "doorStaff");
  const { req, res, next } = buildReqRes({ id: "1", role: "doorStaff" });
  mw(req, res, next);
  expect(next).toHaveBeenCalled();
});
