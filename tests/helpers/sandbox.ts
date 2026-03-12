import { HyperbrowserError } from "../../src/client";
import type { SandboxHandle } from "../../src/services/sandboxes";
import type { CreateSandboxParams } from "../../src/types";
import { DEFAULT_IMAGE_NAME } from "./config";

export function defaultSandboxParams(prefix: string): CreateSandboxParams {
  return {
    imageName: DEFAULT_IMAGE_NAME,
  };
}

export async function stopSandboxIfRunning(
  sandbox: SandboxHandle | null | undefined
): Promise<void> {
  if (!sandbox) {
    return;
  }

  try {
    await sandbox.stop();
  } catch (error) {
    if (
      error instanceof HyperbrowserError &&
      (error.statusCode === 404 || error.statusCode === 409)
    ) {
      return;
    }
    throw error;
  }
}

export async function waitForRuntimeReady(
  sandbox: SandboxHandle,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {}
): Promise<void> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await sandbox.exec("true");
      if (result.exitCode === 0) {
        return;
      }
      lastError = new Error(
        `runtime readiness probe exited with code ${result.exitCode ?? "unknown"}`
      );
    } catch (error) {
      if (
        error instanceof HyperbrowserError &&
        error.service === "runtime" &&
        error.retryable
      ) {
        lastError = error;
      } else {
        throw error;
      }
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("sandbox runtime did not become ready");
}
