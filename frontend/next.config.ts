import type { NextConfig } from "next";

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

export default config;
