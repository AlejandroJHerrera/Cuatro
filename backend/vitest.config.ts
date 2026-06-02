import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    forks: { singleFork: true },
    hookTimeout: 30_000,
  },
});
