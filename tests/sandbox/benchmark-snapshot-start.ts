import "../load-env";
import { Hyperbrowser, HyperbrowserError } from "../../src";
import type { CreateSandboxParams } from "../../src/types";
import { DEFAULT_IMAGE_NAME } from "../helpers/config";
import { waitForRuntimeReady } from "../helpers/sandbox";

const API_KEY = process.env.HYPERBROWSER_API_KEY || "";
const BASE_URL = process.env.HYPERBROWSER_BASE_URL || "http://localhost:8080";

// Edit these directly for local benchmarking.
const ITERATIONS = 3;
const SANDBOX = {
  imageName: DEFAULT_IMAGE_NAME,
} satisfies CreateSandboxParams;

type IterationResult = {
  iteration: number;
  sandboxId: string;
  createMs: number;
  runtimeReadyMs: number;
  postCreateReadyMs: number;
};

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
    avgMs: roundMs(average),
    medianMs: roundMs(median),
  };
}

async function runIteration(
  client: Hyperbrowser,
  iteration: number
): Promise<IterationResult> {
  const createStartedAt = performance.now();
  const sandbox = await client.sandboxes.create(SANDBOX);
  const createCompletedAt = performance.now();

  try {
    await waitForRuntimeReady(sandbox);
    const runtimeReadyAt = performance.now();

    return {
      iteration,
      sandboxId: sandbox.id,
      createMs: roundMs(createCompletedAt - createStartedAt),
      runtimeReadyMs: roundMs(runtimeReadyAt - createStartedAt),
      postCreateReadyMs: roundMs(runtimeReadyAt - createCompletedAt),
    };
  } finally {
    try {
      await sandbox.stop();
    } catch (error) {
      console.error(`failed to stop sandbox ${sandbox.id}: ${String(error)}`);
    }
  }
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

  const results: IterationResult[] = [];

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    console.log(`starting iteration ${iteration}/${ITERATIONS}`);
    try {
      const result = await runIteration(client, iteration);
      results.push(result);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        console.error(
          JSON.stringify(
            {
              iteration,
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
      return;
    }
  }

  console.log("summary");
  console.log(
    JSON.stringify(
      {
        imageName: SANDBOX.imageName,
        imageId: "imageId" in SANDBOX ? SANDBOX.imageId : undefined,
        iterations: results.length,
        create: summarize(results.map((result) => result.createMs)),
        runtimeReady: summarize(results.map((result) => result.runtimeReadyMs)),
        postCreateReady: summarize(
          results.map((result) => result.postCreateReadyMs)
        ),
      },
      null,
      2
    )
  );
}

void main();
