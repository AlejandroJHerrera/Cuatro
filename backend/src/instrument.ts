import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Errors only; no performance tracing for a single-show app.
  });
  console.log("[sentry] error monitoring enabled");
}
