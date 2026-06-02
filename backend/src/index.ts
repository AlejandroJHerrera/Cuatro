import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { movieRouter } from "./routes/movie.js";
import { seatsRouter } from "./routes/seats.js";
import { holdsRouter } from "./routes/holds.js";
import { myTicketsRouter } from "./routes/myTickets.js";
import { checkoutVerifyRouter } from "./routes/checkoutVerify.js";
import { ordersRouter } from "./routes/orders.js";
import { ClaudeVerifier } from "./services/paymentVerifier.js";
import { sessionMiddleware } from "./auth/session.js";
import { passport } from "./auth/passport.js";
import { authRouter } from "./auth/routes.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
// In dev, Next picks the next free port (3000 → 3001), so accept both.
const allowedOrigins =
  env.NODE_ENV === "development"
    ? [env.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"]
    : [env.FRONTEND_URL];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api", authRouter);
app.use("/api/movie", movieRouter);
app.use("/api/seats", seatsRouter);
app.use("/api/holds", holdsRouter);
app.use("/api/my-tickets", myTicketsRouter);
app.use("/api/checkout", checkoutVerifyRouter({ verifier: new ClaudeVerifier() }));
app.use("/api/orders", ordersRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
};
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`Cuatro backend on http://localhost:${env.PORT} (env=${env.NODE_ENV})`);
});

const shutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down…`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
