import { prisma } from "../db.js";
import bcrypt from "bcryptjs";

export async function makeUser(overrides: { email?: string; role?: "customer" | "doorStaff" | "admin"; name?: string } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `u${Date.now()}-${Math.random()}@test.local`,
      name: overrides.name ?? "Test User",
      provider: "email",
      passwordHash: await bcrypt.hash("password123", 4),
      role: overrides.role ?? "customer",
    },
  });
}

export async function makeMovie() {
  return prisma.movie.create({
    data: {
      title: "CUATRO",
      director: "Jose Javier Diaz",
      synopsis: "test",
      startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      runtimeMin: 90,
      language: "ES",
      year: 2026,
      venueName: "Test Venue",
      venueAddress: "Test",
      priceLps: 12,
    },
  });
}

export async function makeSeats(movieId: string, labels: string[]) {
  return Promise.all(
    labels.map((label, i) =>
      prisma.seat.create({
        data: {
          movieId,
          row: label[0] ?? "",
          num: Number(label.slice(1)),
          col: i + 1,
          label,
        },
      }),
    ),
  );
}

export async function makeHold(userId: string, seatId: string, ttlMs = 10 * 60 * 1000) {
  return prisma.seatHold.create({
    data: { userId, seatId, expiresAt: new Date(Date.now() + ttlMs) },
  });
}
