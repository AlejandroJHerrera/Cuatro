import "dotenv/config";
import { beforeAll, beforeEach, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { prisma } from "../db.js";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://cuatro:cuatro@localhost:5433/cuatro_test";
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PaymentReceipt", "Ticket", "SeatHold", "Order", "Seat", "Movie", "User" RESTART IDENTITY CASCADE;`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
