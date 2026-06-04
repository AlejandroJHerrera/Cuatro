import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
  });
}

// Required by @sentry/nextjs for navigation instrumentation
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
