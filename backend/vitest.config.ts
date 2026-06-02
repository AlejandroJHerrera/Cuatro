import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.test", override: true });

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    forks: { singleFork: true },
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
