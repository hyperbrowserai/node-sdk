import { afterEach, describe, expect, test, vi } from "vitest";
import { Headers, Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});

import { HyperbrowserError } from "../../src/client";
import type { RuntimeTransport } from "../../src/sandbox/base";
import { SandboxProcessesApi, SecretProcessStarter } from "../../src/sandbox/process";
import { BaseService } from "../../src/services/base";
import { SandboxesService } from "../../src/services/sandboxes";

const wireDetail = {
  id: "sbx_123",
  status: "active",
  region: "us",
  runtime: { transport: "regional_proxy", host: "h", baseUrl: "https://runtime.example.com" },
  exposedPorts: [],
  containsSecrets: true,
  token: "tok",
  tokenExpiresAt: null,
};

const rawProcess = {
  id: "proc_1",
  status: "running" as const,
  command: "node app.js",
  cwd: "/app",
  pid: 42,
  started_at: 10,
};

const resolved = [{ env: "API_KEY", name: "provider-key", secretId: "s1", version: 2 }];

const result = {
  id: "proc_1",
  status: "exited",
  exit_code: 0,
  stdout: "ok\n",
  stderr: "",
  started_at: 10,
  completed_at: 11,
};

const starter = (
  start: SecretProcessStarter["start"] = vi.fn(async () => ({
    process: rawProcess,
    secrets: resolved,
  }))
) => ({ sandboxId: "sbx_123", waitChunkMs: 20_000, start: vi.fn(start) });

/** A runtime transport whose requestJSON answers from `routes` in order per path. */
const runtime = (routes: Record<string, Array<unknown>>) => {
  const requestJSON = vi.fn(async (path: string, _init?: { body?: string }) => {
    const queue = routes[path];
    const next = queue?.shift();
    if (next === undefined) throw new Error(`unexpected runtime call ${path}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const openSSE = vi.fn();
  return {
    requestJSON,
    openSSE,
    transport: { requestJSON, openSSE } as unknown as RuntimeTransport,
  };
};

describe("sandbox create with secrets", () => {
  test("image launches send secret references in the API shape", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireDetail);

    const sandbox = await service.create({
      imageName: "node",
      secrets: { API_KEY: "provider-key", DB_URL: { name: "db-url", version: 3 } },
    });

    const body = JSON.parse((requestSpy.mock.calls[0][1] as any).body);
    expect(body.secrets).toEqual({
      API_KEY: { name: "provider-key" },
      DB_URL: { name: "db-url", version: 3 },
    });
    expect(sandbox.toJSON().containsSecrets).toBe(true);
  });

  test("snapshot launches and bad references are rejected locally", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireDetail);

    await expect(
      service.create({ snapshotName: "snap", secrets: { A: "x" } } as any)
    ).rejects.toThrow(/only supported for image launches/);
    await expect(service.create({ imageName: "node", secrets: { "1BAD": "x" } })).rejects.toThrow(
      /environment variable name/
    );
    await expect(
      service.create({ imageName: "node", secrets: { A: { name: "x", version: 0 } } })
    ).rejects.toThrow(/positive integer/);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe("processes with secrets", () => {
  test("start goes through the control API and reports the delivered versions", async () => {
    const start = starter();
    const { transport, openSSE } = runtime({});
    const api = new SandboxProcessesApi(transport, start);

    const handle = await api.start("node app.js", {
      cwd: "/app",
      env: { NODE_ENV: "production" },
      timeoutSec: 30,
      runAs: "root",
      secrets: { API_KEY: { name: "provider-key", version: "latest" } },
    });

    expect(openSSE).not.toHaveBeenCalled();
    expect(start.start).toHaveBeenCalledWith(
      {
        command: "node app.js",
        cwd: "/app",
        env: { NODE_ENV: "production" },
        timeoutMs: 30_000,
        runAs: "root",
        secrets: { API_KEY: { name: "provider-key", version: "latest" } },
      },
      undefined
    );
    expect(handle.id).toBe("proc_1");
    expect(handle.toJSON()).toMatchObject({ pid: 42, startedAt: 10, cwd: "/app" });
    expect(handle.secrets).toEqual(resolved);
  });

  test("a variable set by both env and secrets is rejected before starting", async () => {
    const start = starter();
    const api = new SandboxProcessesApi(runtime({}).transport, start);
    await expect(
      api.start({ command: "env", env: { API_KEY: "x" }, secrets: { API_KEY: "provider-key" } })
    ).rejects.toThrow(/both env and secrets: API_KEY/);
    expect(start.start).not.toHaveBeenCalled();
  });

  test("exec closes stdin and waits past expired waits for the final result", async () => {
    const expired = new HyperbrowserError("wait timed out", { statusCode: 408 });
    const { transport, requestJSON } = runtime({
      "/sandbox/processes/proc_1/stdin": [new HyperbrowserError("exited", { statusCode: 409 })],
      "/sandbox/processes/proc_1/wait": [expired, expired, { result }],
    });
    const api = new SandboxProcessesApi(transport, starter());

    const output = await api.exec("node app.js", { secrets: { API_KEY: "provider-key" } });

    expect(output).toMatchObject({ id: "proc_1", exitCode: 0, stdout: "ok\n" });
    expect(requestJSON.mock.calls.map(([path]) => path)).toEqual([
      "/sandbox/processes/proc_1/stdin",
      "/sandbox/processes/proc_1/wait",
      "/sandbox/processes/proc_1/wait",
      "/sandbox/processes/proc_1/wait",
    ]);
    expect(JSON.parse((requestJSON.mock.calls[0][1] as any).body)).toEqual({ eof: true });
    expect(JSON.parse((requestJSON.mock.calls[1][1] as any).body)).toMatchObject({
      timeoutMs: 20_000,
    });
  });

  test("a failure after the start names the running process", async () => {
    const { transport } = runtime({
      "/sandbox/processes/proc_1/stdin": [{ success: true }],
      "/sandbox/processes/proc_1/wait": [new HyperbrowserError("gone", { statusCode: 502 })],
    });
    const api = new SandboxProcessesApi(transport, starter());
    const error = await api.exec("x", { secrets: { A: "s" } }).catch((e) => e);
    expect(error).toMatchObject({
      code: "secret_process_failed",
      retryable: false,
      details: { sandboxId: "sbx_123", processId: "proc_1" },
    });
    expect(error.message).toContain("Process proc_1 started");
  });

  test("an unreadable or timed-out start is an unknown outcome; API errors pass through", async () => {
    const timedOut = new HyperbrowserError("network timeout", {
      cause: Object.assign(new Error("timeout"), { type: "request-timeout" }),
    });
    const refused = new HyperbrowserError("refused", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    });
    const apiError = new HyperbrowserError("denied", {
      statusCode: 403,
      code: "API_KEY_SCOPE_DENIED",
    });

    for (const [error, code] of [
      [timedOut, "secret_process_outcome_unknown"],
      [refused, undefined],
      [apiError, "API_KEY_SCOPE_DENIED"],
    ] as const) {
      const api = new SandboxProcessesApi(
        runtime({}).transport,
        starter(async () => {
          throw error;
        })
      );
      await expect(api.start({ command: "x", secrets: { A: "s" } })).rejects.toMatchObject({
        code,
      });
    }

    const missingId = new SandboxProcessesApi(
      runtime({}).transport,
      starter(async () => ({ secrets: resolved }))
    );
    await expect(missingId.start({ command: "x", secrets: { A: "s" } })).rejects.toMatchObject({
      code: "secret_process_outcome_unknown",
    });
  });

  test("sandbox handles start secret processes on their own sandbox", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi
      .spyOn(service as any, "request")
      .mockResolvedValueOnce(wireDetail)
      .mockResolvedValueOnce({ process: rawProcess, secrets: resolved });
    const sandbox = await service.get("sbx_123");

    const handle = await sandbox.processes.start({
      command: "node app.js",
      secrets: { API_KEY: "provider-key" },
    });

    expect(handle.secrets).toEqual(resolved);
    expect(requestSpy.mock.calls[1][0]).toBe("/sandbox/sbx_123/processes");
    expect(JSON.parse((requestSpy.mock.calls[1][1] as any).body)).toEqual({
      command: "node app.js",
      secrets: { API_KEY: { name: "provider-key" } },
    });
  });
});

describe("control API error fields", () => {
  class TestService extends BaseService {
    post<T>(path: string) {
      return this.request<T>(path, { method: "POST", body: "{}" });
    }
  }

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: new Headers({ "content-type": "application/json" }),
      })
    );

  afterEach(() => fetchMock.mockReset());

  test("the server's retryable flag wins over the status code", async () => {
    respond(502, { code: "SECRET_PROCESS_OUTCOME_UNKNOWN", message: "unknown", retryable: false });
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.post("/x")).rejects.toMatchObject({
      statusCode: 502,
      code: "SECRET_PROCESS_OUTCOME_UNKNOWN",
      retryable: false,
    });
  });

  test("a machine code sent as error next to a message becomes the code", async () => {
    respond(403, {
      error: "API_KEY_SCOPE_DENIED",
      message: "denied",
      requiredScopes: ["secrets.use"],
    });
    const service = new TestService("key", "https://api.example.com", 1_000);
    const error = (await service.post("/x").catch((e: unknown) => e)) as HyperbrowserError;
    expect(error).toMatchObject({ code: "API_KEY_SCOPE_DENIED", statusCode: 403 });
    expect(error.message).toContain("denied");
    expect(error.details).toMatchObject({ requiredScopes: ["secrets.use"] });
  });

  test("a plain error message is not taken as a code", async () => {
    respond(400, { error: "Invalid body" });
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.post("/x")).rejects.toMatchObject({ code: undefined, retryable: false });
  });
});
