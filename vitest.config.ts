import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/sandbox/e2e/*-contract.test.ts",
      "tests/sandbox/e2e/process-api.test.ts",
      "tests/sandbox/e2e/runtime-transport.test.ts",
    ],
    setupFiles: ["./tests/load-env.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ["default"],
  },
});
