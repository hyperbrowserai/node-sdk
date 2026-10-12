import { IncomingMessage, ServerResponse } from "http";
import { afterEach, describe, expect, test } from "vitest";
import { HyperbrowserError } from "../../src/error";
import { SandboxesService } from "../../src/services/sandboxes";
import { localHTTP } from "../helpers/local-http";

const sandboxId = "sbx_123";
const processId = "proc_1";
const startPath = `/api/sandbox/${sandboxId}/processes`;
const waitPath = `/sandbox/processes/${processId}/wait`;
const rawProcess = {
  id: processId,
  status: "running",
  command: "node app.js",
  cwd: "/app",
  pid: 42,
  started_at: 10,
};
const resolvedSecrets = [
  { env: "API_KEY", name: "provider-key", secretId: "secret_1", version: 2 },
];
const rawResult = {
  id: processId,
  status: "exited",
  exit_code: 0,
  stdout: "ok\n",
  stderr: "",
  started_at: 10,
  completed_at: 11,
};
const command = {
  command: "node app.js",
  cwd: "/app",
  secrets: { API_KEY: { name: "provider-key", version: 2 } },
};
type Call = {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  headers: IncomingMessage["headers"];
};
type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  call: Call
) => boolean | Promise<boolean>;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function within<T>(pending: Promise<T>, ms = 1_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No response within ${ms}ms`)), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function setup(handle?: Handler, timeout = 30_000) {
  const calls: Call[] = [];
  let runtimeUrl = "";
  const server = await localHTTP(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const call = {
      method: req.method!,
      path: req.url!,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined,
      headers: req.headers,
    };
    calls.push(call);
    if (call.method === "GET" && call.path === `/api/sandbox/${sandboxId}`) {
      json(res, {
        id: sandboxId,
        teamId: "test-team",
        status: "active",
        region: "us",
        duration: 0,
        createdAt: "now",
        updatedAt: "now",
        sessionUrl: "https://sandbox.example.test",
        runtime: { transport: "regional_proxy", host: "local.test", baseUrl: runtimeUrl },
        exposedPorts: [],
        containsSecrets: true,
        token: "local-runtime-token",
        tokenExpiresAt: null,
      });
    } else if (handle && (await handle(req, res, call))) {
      return;
    } else if (call.method === "POST" && call.path === startPath) {
      json(res, { process: rawProcess, secrets: resolvedSecrets });
    } else if (call.method === "GET" && call.path === `/sandbox/processes/${processId}`) {
      json(res, { process: rawProcess });
    } else if (call.method === "POST" && call.path === `/sandbox/processes/${processId}/stdin`) {
      json(res, { success: true });
    } else {
      json(res, { message: `Unexpected ${call.method} ${call.path}` }, 404);
    }
  });
  cleanup.push(server.close);
  runtimeUrl = server.url;
  const service = new SandboxesService("local-control-key", server.url, timeout);
  return { ...server, calls, sandbox: await service.get(sandboxId) };
}

describe("secret process recovery over HTTP", () => {
  test.each(["wait", "result"] as const)(
    "start().%s() continues bounded receiver waits through multiple 408 responses",
    async (method) => {
      const waits: Call[] = [];
      const api = await setup((_req, res, call) => {
        if (call.path !== waitPath) return false;
        waits.push(call);
        // Return receiver wait expirations immediately; no real 30-second sleep is needed.
        if (waits.length <= 3) json(res, { message: "Process is still running" }, 408);
        else json(res, { result: rawResult });
        return true;
      });
      const handle = await api.sandbox.processes.start(command);

      await expect(handle[method]()).resolves.toMatchObject({
        id: processId,
        exitCode: 0,
        stdout: "ok\n",
      });
      expect(handle.secrets).toEqual(resolvedSecrets);
      expect(waits).toHaveLength(4);
      for (const call of waits) {
        expect(call.method).toBe("POST");
        expect(call.body?.timeoutMs).toBeGreaterThan(0);
        expect(call.body?.timeoutMs).toBeLessThanOrEqual(20_000);
        expect(call.body?.timeoutMs).toBeLessThan(30_000);
        expect(call.body?.timeout_sec).toBeUndefined();
      }
      const starts = api.calls.filter((call) => call.path === startPath);
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({
        method: "POST",
        body: command,
        headers: { "x-api-key": "local-control-key" },
      });
    }
  );

  test("an explicit wait deadline closes the response body and leaves the same handle usable", async () => {
    const accepted = deferred();
    const closed = deferred();
    const waits: Call[] = [];
    const api = await setup((req, res, call) => {
      if (call.path !== waitPath) return false;
      waits.push(call);
      if (waits.length === 1) {
        req.socket.once("close", closed.resolve);
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"result":');
        accepted.resolve();
      } else json(res, { result: rawResult });
      return true;
    }, 3_000);
    const handle = await api.sandbox.processes.start(command);
    const pending = handle.wait({ timeoutMs: 250 }).catch((error: unknown) => error);
    await within(accepted.promise);

    expect(await within(pending)).toMatchObject({
      code: "wait_timeout",
      retryable: false,
      service: "runtime",
    });
    await within(closed.promise);
    expect(waits[0].body?.timeoutMs).toBeGreaterThan(0);
    expect(waits[0].body?.timeoutMs).toBeLessThanOrEqual(250);
    await expect(handle.wait()).resolves.toMatchObject({ id: processId, exitCode: 0 });
    expect(waits).toHaveLength(2);
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
  });

  test("a reattached ordinary process still performs one receiver wait and returns its 408", async () => {
    const waits: Call[] = [];
    const api = await setup((_req, res, call) => {
      if (call.path !== waitPath) return false;
      waits.push(call);
      json(res, { message: "Process is still running" }, 408);
      return true;
    });
    const handle = await api.sandbox.processes.get(processId);

    await expect(handle.wait()).rejects.toMatchObject({ statusCode: 408 });
    expect(waits).toHaveLength(1);
    expect(waits[0].body).toEqual({});
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(0);
  });

  test("a 200ms SDK request budget permits secret exec to span several 100ms waits", async () => {
    const waits: Call[] = [];
    const api = await setup((_req, res, call) => {
      if (call.path !== waitPath) return false;
      waits.push(call);
      const count = waits.length;
      const timer = setTimeout(() => {
        if (count < 3) json(res, { message: "Process is still running" }, 408);
        else json(res, { result: rawResult });
      }, 100);
      res.once("close", () => clearTimeout(timer));
      return true;
    }, 200);
    const startedAt = Date.now();

    await expect(
      api.sandbox.processes.exec({ ...command, timeoutMs: 1_000 })
    ).resolves.toMatchObject({ id: processId, exitCode: 0 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(waits.map((call) => call.body)).toEqual([
      { timeoutMs: 100 },
      { timeoutMs: 100 },
      { timeoutMs: 100 },
    ]);
    expect(api.calls.find((call) => call.path === startPath)?.body?.timeoutMs).toBe(1_000);
    expect(
      api.calls.find((call) => call.path === `/sandbox/processes/${processId}/stdin`)?.body
    ).toEqual({ eof: true });
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
  });

  test("a disabled millisecond command timeout falls back to the positive seconds alias", async () => {
    const api = await setup();

    await api.sandbox.processes.start({ ...command, timeoutMs: 0, timeoutSec: 1 });

    expect(api.calls.find((call) => call.path === startPath)?.body).toEqual({
      ...command,
      timeoutMs: 1_000,
    });
  });
});

describe("secret process cancellation over HTTP", () => {
  test.each(["start", "exec"] as const)(
    "a preaborted %s signal sends no process POST",
    async (method) => {
      const api = await setup();
      const controller = new AbortController();
      controller.abort();

      await expect(
        api.sandbox.processes[method]({ ...command, signal: controller.signal })
      ).rejects.toMatchObject({ code: "request_aborted", retryable: false });
      expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(0);
    }
  );

  test.each([
    { name: "before any response", responseStatus: undefined },
    { name: "after partial 502 headers and body", responseStatus: 502 },
  ])(
    "aborting an accepted control start $name reports an unknown outcome without a retry",
    async ({ responseStatus }) => {
      const accepted = deferred();
      const closed = deferred();
      const api = await setup((req, res, call) => {
        if (call.path !== startPath) return false;
        req.socket.once("close", closed.resolve);
        if (responseStatus === undefined) accepted.resolve();
        else {
          res.writeHead(responseStatus, { "content-type": "application/json" });
          res.write('{"code":');
          // Allow node-fetch to consume the error headers before caller cancellation.
          const timer = setTimeout(accepted.resolve, 50);
          res.once("close", () => clearTimeout(timer));
        }
        return true;
      }, 3_000);
      const controller = new AbortController();
      const pending = api.sandbox.processes
        .start({ ...command, signal: controller.signal })
        .catch((error: unknown) => error);
      await within(accepted.promise);
      controller.abort();

      const error = await within(pending);
      expect(error).toMatchObject({
        code: "secret_process_outcome_unknown",
        retryable: false,
        details: { sandboxId },
        cause: { code: "request_aborted", retryable: false },
      });
      if (responseStatus !== undefined)
        expect(error).toMatchObject({ cause: { statusCode: responseStatus } });
      await within(closed.promise);
      expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
    }
  );

  test("aborting an in-flight exec wait promptly closes its socket and retains process IDs", async () => {
    const accepted = deferred();
    const closed = deferred();
    const api = await setup((req, res, call) => {
      if (call.path !== waitPath) return false;
      req.socket.once("close", closed.resolve);
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"result":');
      accepted.resolve();
      return true;
    }, 5_000);
    const controller = new AbortController();
    const pending = api.sandbox.processes
      .exec({ ...command, signal: controller.signal })
      .catch((error: unknown) => error);
    await within(accepted.promise);
    controller.abort();

    expect(await within(pending)).toMatchObject({
      code: "secret_process_failed",
      retryable: false,
      service: "runtime",
      details: { sandboxId, processId },
      cause: { code: "request_aborted", retryable: false },
    });
    await within(closed.promise);
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
    expect(api.calls.filter((call) => call.path === waitPath)).toHaveLength(1);
  });
});

describe("secret start error responses over HTTP", () => {
  test.each(["malformed", "interrupted"] as const)(
    "an unreadable %s 502 body reports an unknown outcome without a retry",
    async (mode) => {
      const api = await setup((req, res, call) => {
        if (call.path !== startPath) return false;
        res.writeHead(502, {
          "content-type": "application/json",
          "x-request-id": "secret-start-unreadable",
        });
        if (mode === "malformed") res.end("<html>Upstream failure</html>");
        else {
          res.write('{"code":');
          // Give node-fetch the headers and partial body before severing the response.
          const timer = setTimeout(() => req.socket.destroy(), 50);
          res.once("close", () => clearTimeout(timer));
        }
        return true;
      });

      await expect(api.sandbox.processes.start(command)).rejects.toMatchObject({
        code: "secret_process_outcome_unknown",
        retryable: false,
        details: { sandboxId },
        cause: { statusCode: 502, requestId: "secret-start-unreadable" },
      });
      expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
    }
  );

  test("the API's unconfirmed start is reported as an unknown outcome without a retry", async () => {
    const body = {
      code: "SECRET_PROCESS_OUTCOME_UNKNOWN",
      message: "The sandbox host did not confirm the process start",
      retryable: false,
    };
    const api = await setup((_req, res, call) => {
      if (call.path !== startPath) return false;
      json(res, body, 502);
      return true;
    });
    const error = await api.sandbox.processes.start(command).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error).toMatchObject({
      statusCode: 502,
      code: "secret_process_outcome_unknown",
      retryable: false,
      service: "control",
      details: { ...body, sandboxId },
      cause: { code: "SECRET_PROCESS_OUTCOME_UNKNOWN" },
    });
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
  });

  test.each([
    { status: 503, code: "SECRET_PROCESS_NOT_STARTED", retryable: true },
    { status: 500, code: "SECRET_DECRYPT_FAILED", retryable: false },
  ])("a valid $status API error preserves its code and retryable=$retryable", async (response) => {
    const api = await setup((_req, res, call) => {
      if (call.path !== startPath) return false;
      json(
        res,
        { code: response.code, message: "Process start failed", retryable: response.retryable },
        response.status
      );
      return true;
    });
    const error = await api.sandbox.processes.start(command).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error).toMatchObject({
      statusCode: response.status,
      code: response.code,
      retryable: response.retryable,
      service: "control",
    });
    expect(api.calls.filter((call) => call.path === startPath)).toHaveLength(1);
  });
});
