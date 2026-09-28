import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    project: ["unit", "integration"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ["default"],
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          setupFiles: ["./tests/load-env.ts"],
        },
      },
    ],
  },
});
