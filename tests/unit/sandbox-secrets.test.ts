import { afterEach, describe, expect, test, vi } from "vitest";
import { FetchError, Headers, Response } from "node-fetch";

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
    ).rejects.toThrow(/integer from 1 to 2147483647/);
    await expect(
      service.create({ imageName: "node", secrets: { A: { name: "x", version: 2 ** 31 } } })
    ).rejects.toThrow(/integer from 1 to 2147483647/);
    await expect(
      service.create({ imageName: "node", runtimeClass: "gvisor-cpu", secrets: { A: "x" } })
    ).rejects.toThrow(/not supported with runtimeClass gvisor-cpu/);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("containsSecrets defaults to false when a response omits it", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const { containsSecrets: _omitted, ...withoutFlag } = wireDetail;
    vi.spyOn(service as any, "request").mockResolvedValue(withoutFlag);
    expect((await service.get("sbx_123")).toJSON().containsSecrets).toBe(false);
  });
});

describe("sandbox create with secrets and an unknown result", () => {
  afterEach(() => fetchMock.mockReset());

  const service = () => new SandboxesService("test-key", "https://api.example.com", 1_000);
  const create = (secrets?: Record<string, string>) =>
    service()
      .create({ imageName: "node", ...(secrets ? { secrets } : {}) })
      .catch((error: unknown) => error) as Promise<HyperbrowserError>;

  test("a timed-out create is never retried and reports that a sandbox may exist", async () => {
    fetchMock.mockRejectedValue(
      new FetchError("network timeout at: /api/sandbox", "request-timeout")
    );

    const error = await create({ API_KEY: "provider-key" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error).toMatchObject({
      code: "secret_process_outcome_unknown",
      retryable: false,
      service: "control",
      cause: { retryable: true },
    });
    expect(error.message).toContain(
      "could not confirm the create result: network timeout at: /api/sandbox; a sandbox may have been created with the secrets"
    );
    expect(error.message).toContain("list sandboxes before retrying");
  });

  test("an unreadable create response is an unknown outcome", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>ok</html>", { status: 200 }));
    await expect(create({ API_KEY: "provider-key" })).resolves.toMatchObject({
      code: "secret_process_outcome_unknown",
      retryable: false,
    });
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(create({ API_KEY: "provider-key" })).resolves.toMatchObject({
      code: "secret_process_outcome_unknown",
      cause: { statusCode: 502 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("API errors, failed connections and creates without secrets pass through", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "SECRET_NOT_FOUND", message: "missing" }), {
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
      })
    );
    await expect(create({ API_KEY: "provider-key" })).resolves.toMatchObject({
      code: "SECRET_NOT_FOUND",
      statusCode: 404,
    });

    fetchMock.mockRejectedValueOnce(
      new FetchError(
        "connect ECONNREFUSED",
        "system",
        Object.assign(new Error("refused"), {
          code: "ECONNREFUSED",
        })
      )
    );
    await expect(create({ API_KEY: "provider-key" })).resolves.toMatchObject({
      code: undefined,
      retryable: true,
    });

    fetchMock.mockRejectedValueOnce(new FetchError("network timeout", "request-timeout"));
    await expect(create()).resolves.toMatchObject({ code: undefined, retryable: true });
  });

  test.each([null, {}, { ...wireDetail, id: "" }, { ...wireDetail, id: 42 }])(
    "an incomplete create response is an unknown outcome: %j",
    async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
      await expect(create({ API_KEY: "provider-key" })).resolves.toMatchObject({
        code: "secret_process_outcome_unknown",
        retryable: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
});

describe("processes with secrets", () => {
  test.each([null, {}, { process: null }, { process: { id: " " } }, { process: { id: 42 } }])(
    "an incomplete process response preserves the unknown outcome: %j",
    async (response) => {
      const start = starter(async () => response as any);
      const api = new SandboxProcessesApi(runtime({}).transport, start);
      await expect(api.start("x", { secrets: { A: "s" } })).rejects.toMatchObject({
        code: "secret_process_outcome_unknown",
        retryable: false,
        details: { sandboxId: "sbx_123" },
      });
      expect(start.start).toHaveBeenCalledTimes(1);
    }
  );

  test("accepts the receiver's processId alias", async () => {
    const { id, ...process } = rawProcess;
    const start = starter(async () => ({ process: { ...process, processId: id } }) as any);
    const api = new SandboxProcessesApi(runtime({}).transport, start);
    expect((await api.start("x", { secrets: { A: "s" } })).id).toBe(id);
  });

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

  test("command timeouts are sent as whole milliseconds within the API's range", async () => {
    for (const [timeouts, timeoutMs] of [
      [{ timeoutSec: 1.5 }, 1_500],
      [{ timeoutSec: 1.1 }, 1_100],
      [{ timeoutSec: 0.0001 }, 1],
      [{ timeoutMs: 2.4 }, 2],
      [{ timeoutSec: 0, timeoutMs: 250 }, 250],
      [{ timeoutSec: 86_400 }, 86_400_000],
      [{ timeoutSec: 0 }, undefined],
    ] as const) {
      const start = starter();
      const api = new SandboxProcessesApi(runtime({}).transport, start);
      await api.start({ command: "x", ...timeouts, secrets: { A: "s" } });
      expect(start.start.mock.calls[0][0].timeoutMs).toBe(timeoutMs);
    }

    for (const timeouts of [
      { timeoutSec: 86_400.001 },
      { timeoutMs: 86_400_001 },
      { timeoutSec: -1 },
      { timeoutMs: Number.NaN },
      { timeoutSec: Number.POSITIVE_INFINITY },
    ]) {
      const start = starter();
      const api = new SandboxProcessesApi(runtime({}).transport, start);
      await expect(api.start({ command: "x", ...timeouts, secrets: { A: "s" } })).rejects.toThrow(
        /non-negative number|at most 86400 seconds/
      );
      expect(start.start).not.toHaveBeenCalled();
    }
  });

  test("the API's unconfirmed start becomes secret_process_outcome_unknown", async () => {
    const body = {
      code: "SECRET_PROCESS_OUTCOME_UNKNOWN",
      message: "The sandbox host did not confirm the process start",
      retryable: false,
    };
    const apiError = new HyperbrowserError(body.message, {
      statusCode: 502,
      code: body.code,
      requestId: "req_1",
      retryable: false,
      service: "control",
      details: body,
    });
    const api = new SandboxProcessesApi(
      runtime({}).transport,
      starter(async () => {
        throw apiError;
      })
    );

    const error = await api.start({ command: "x", secrets: { A: "s" } }).catch((e) => e);

    expect(error).toMatchObject({
      statusCode: 502,
      code: "secret_process_outcome_unknown",
      requestId: "req_1",
      retryable: false,
      details: { ...body, sandboxId: "sbx_123" },
      cause: apiError,
    });
    expect(error.message).toBe(`[Hyperbrowser]: ${body.message}`);
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

  test("SECRETS_NOT_CONFIGURED is not retried despite its 503", async () => {
    respond(503, { code: "SECRETS_NOT_CONFIGURED", message: "not configured" });
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.post("/x")).rejects.toMatchObject({
      statusCode: 503,
      code: "SECRETS_NOT_CONFIGURED",
      retryable: false,
    });

    class GetService extends BaseService {
      get<T>(path: string) {
        return this.request<T>(path);
      }
    }
    respond(503, { code: "SECRETS_NOT_CONFIGURED", message: "not configured" });
    await expect(
      new GetService("key", "https://api.example.com", 1_000).get("/secrets/public-key")
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("messages name the sandbox and the secret an error is about", async () => {
    const service = new TestService("key", "https://api.example.com", 1_000);
    respond(500, {
      code: "SECRET_STARTUP_FAILED",
      message: "Startup failed",
      sandboxId: "sbx_9",
      details: { env: "API_KEY", secretId: "secret_1", version: 3 },
    });
    const error = (await service.post("/x").catch((e: unknown) => e)) as HyperbrowserError;
    expect(error.message).toBe(
      "[Hyperbrowser]: Startup failed (sandbox sbx_9) (API_KEY: secret secret_1, version 3)"
    );
    expect(error.details).toMatchObject({ sandboxId: "sbx_9" });

    respond(400, { error: "Bad secret", details: { env: "DB_URL" } });
    await expect(service.post("/x")).rejects.toThrow(/^\[Hyperbrowser\]: Bad secret \(DB_URL\)$/);

    respond(400, { message: "Invalid", details: { reason: "other shape" } });
    await expect(service.post("/x")).rejects.toThrow(/^\[Hyperbrowser\]: Invalid$/);

    respond(409, { sandboxId: "sbx_9" });
    await expect(service.post("/x")).rejects.toThrow(/^\[Hyperbrowser\]: HTTP error! status: 409$/);
  });

  test("a plain error message is not taken as a code", async () => {
    respond(400, { error: "Invalid body" });
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.post("/x")).rejects.toMatchObject({ code: undefined, retryable: false });
  });
});
