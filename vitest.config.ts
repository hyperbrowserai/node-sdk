import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/sandbox/e2e/**/*.test.ts"],
    setupFiles: ["./tests/load-env.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ["default"],
  },
});
