import "../load-env";
import { Hyperbrowser, HyperbrowserError } from "../../src";
import type {
  CreateSandboxParams,
  SandboxDetail,
  SandboxProcessResult,
} from "../../src/types";

const API_KEY = process.env.HYPERBROWSER_API_KEY || "";
const BASE_URL = process.env.HYPERBROWSER_BASE_URL || "http://localhost:8080";
const COMMAND = "echo hb-sdk-start-stop-ok";

const SANDBOX = {
  sandboxName: `sdk-smoke-${Date.now()}`,
  snapshotName: "receiverStarted-ubuntu-24-node",
} satisfies CreateSandboxParams;

function summarizeSandbox(detail: SandboxDetail) {
  return {
    id: detail.id,
    status: detail.status,
    region: detail.region,
    runtimeBaseUrl: detail.runtime.baseUrl,
    tokenExpiresAt: detail.tokenExpiresAt,
    sessionUrl: detail.sessionUrl,
  };
}

function summarizeResult(result: SandboxProcessResult) {
  return {
    id: result.id,
    status: result.status,
    exitCode: result.exitCode ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

async function main() {
  if (!API_KEY) {
    throw new Error(
      "Set HYPERBROWSER_API_KEY in tests/.env before running this script"
    );
  }

  const client = new Hyperbrowser({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  let sandbox: Awaited<ReturnType<typeof client.sandboxes.create>> | null = null;

  try {
    sandbox = await client.sandboxes.create(SANDBOX);
    console.log("sandbox created");
    console.log(JSON.stringify(summarizeSandbox(sandbox.toJSON()), null, 2));

    const result = await sandbox.exec(COMMAND);
    console.log("command result");
    console.log(JSON.stringify(summarizeResult(result), null, 2));

    if (result.exitCode !== 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof HyperbrowserError) {
      console.error("sdk error");
      console.error(
        JSON.stringify(
          {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code,
            requestId: error.requestId,
            retryable: error.retryable,
            service: error.service,
            details: error.details,
          },
          null,
          2
        )
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
    if (sandbox) {
      try {
        const stopResponse = await sandbox.stop();
        console.log("sandbox stopped");
        console.log(JSON.stringify(stopResponse, null, 2));
      } catch (error) {
        console.error("failed to stop sandbox");
        console.error(error);
        process.exitCode = 1;
      }
    }
  }
}

void main();
