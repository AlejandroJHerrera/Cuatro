import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const BACKEND_INTERNAL = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_INTERNAL}/api/:path*` },
    ];
  },
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok.app", "*.ngrok-free.app"],
};

export default withSentryConfig(config, {
  // Suppress Sentry CLI output during builds
  silent: true,
  // Disable source map upload (no auth token configured)
  sourcemaps: {
    disable: true,
  },
});
