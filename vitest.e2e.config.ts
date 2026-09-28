import { defineConfig } from "vitest/config";
import local from "./vitest.config";
export default defineConfig({
  ...local,
  test: {
    ...local.test,
    include: ["tests/sandbox/e2e/**/*.test.ts"],
    exclude: [
      "tests/sandbox/e2e/*-contract.test.ts",
      "tests/sandbox/e2e/process-api.test.ts",
      "tests/sandbox/e2e/runtime-transport.test.ts",
    ],
  },
});
