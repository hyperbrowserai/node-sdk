/**
 * Intent: verify the sandbox exposed-port SDK surface and runtime auth behavior.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import { fetchRuntimeUrl } from "../../helpers/http";
import { defaultSandboxParams, stopSandboxIfRunning } from "../../helpers/sandbox";

const client = createClient();
const HTTP_PORT = 3210;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForHttpResponse = async (
  url: string,
  init: Parameters<typeof fetchRuntimeUrl>[1],
  predicate: (status: number, body: string) => boolean,
  attempts: number = 15
): Promise<{ status: number; body: string }> => {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchRuntimeUrl(url, init);
      const body = await response.text();
      lastStatus = response.status;
      lastBody = body;
      if (predicate(response.status, body)) {
        return {
          status: response.status,
          body,
        };
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      await sleep(200 * attempt);
    }
  }

  throw new Error(
    `did not receive expected response for ${url}; last status=${lastStatus}, last body=${JSON.stringify(
      lastBody
    )}`
  );
};

describe.sequential("sandbox exposed ports e2e", () => {
  let sandbox: SandboxHandle | null = null;
  let serverProcess:
    | Awaited<ReturnType<NonNullable<SandboxHandle>["processes"]["start"]>>
    | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-expose"));

    serverProcess = await sandbox.processes.start({
      command: "node",
      args: [
        "-e",
        [
          "const http = require('http');",
          `const port = ${HTTP_PORT};`,
          "const server = http.createServer((req, res) => {",
          "  res.writeHead(200, {'content-type': 'text/plain'});",
          "  res.end(`sdk-exposed:${req.method}:${req.url}`);",
          "});",
          "server.listen(port, '0.0.0.0', () => {",
          "  console.log(`listening:${port}`);",
          "});",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
          "process.on('SIGINT', () => server.close(() => process.exit(0)));",
        ].join(" "),
      ],
    });

    await waitForHttpResponse(
      sandbox.getExposedUrl(HTTP_PORT),
      {
        headers: {
          Authorization: `Bearer ${sandbox.toJSON().token}`,
        },
      },
      (status) => status === 403
    );
  });

  afterAll(async () => {
    if (serverProcess) {
      try {
        await serverProcess.kill();
      } catch {
        // Sandbox stop below is enough if the process is already gone.
      }
    }
    await stopSandboxIfRunning(sandbox);
  });

  test("reserved ports are rejected by the SDK expose call", async () => {
    await expectHyperbrowserError(
      "reserved receiver port expose",
      () => sandbox!.expose({ port: 4001 }),
      {
        statusCode: 400,
        service: "control",
        retryable: false,
        messageIncludes: "cannot be exposed",
      }
    );
  });

  test("public expose returns a reachable URL", async () => {
    const exposure = await sandbox!.expose({ port: HTTP_PORT, auth: false });
    expect(exposure.port).toBe(HTTP_PORT);
    expect(exposure.auth).toBe(false);
    expect(exposure.url).toBe(sandbox!.getExposedUrl(HTTP_PORT));

    const response = await waitForHttpResponse(
      exposure.url,
      {},
      (status, body) => status === 200 && body.includes("sdk-exposed:GET:/")
    );

    expect(response.status).toBe(200);
    expect(response.body).toContain("sdk-exposed:GET:/");
  });

  test("auth-protected expose requires the sandbox runtime bearer", async () => {
    const exposure = await sandbox!.expose({ port: HTTP_PORT, auth: true });
    expect(exposure.auth).toBe(true);

    const unauthorized = await waitForHttpResponse(
      exposure.url,
      {},
      (status) => status === 401
    );
    expect(unauthorized.status).toBe(401);

    await sandbox!.refresh();
    const token = sandbox!.toJSON().token;
    expect(token).toBeTruthy();

    const authorized = await waitForHttpResponse(
      exposure.url,
      {
        headers: {
          Authorization: `Bearer ${token!}`,
        },
      },
      (status, body) => status === 200 && body.includes("sdk-exposed:GET:/")
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toContain("sdk-exposed:GET:/");
  });
});
