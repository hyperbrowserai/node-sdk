import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});
vi.mock("../../src/retry", async () => {
  const actual = await vi.importActual<typeof import("../../src/retry")>("../../src/retry");
  return { ...actual, retryDelay: vi.fn().mockResolvedValue(undefined) };
});

import { HyperbrowserClient as Hyperbrowser } from "../../src/client";
import type { CreateSessionParams, WebMCPInvocation, WebMCPTool } from "../../src/types";

const client = (timeout = 1000) =>
  new Hyperbrowser({ apiKey: "test-key", baseUrl: "https://example.test", timeout });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const id = "0123456789abcdef01234567";
const handle = {
  invocationId: id,
  toolRef: "document-tool",
  status: "running",
  cancellationRequested: false,
  createdAt: "2026-10-06T12:00:00Z",
};
const result = {
  status: "completed",
  output: { snake_key: { CamelKey: [null, 42] } },
  outputBytes: 37,
  untrustedContent: true,
  durationMs: 12,
};

afterEach(() => fetchMock.mockReset());

test("session opt-in is optional and preserves explicit false", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ id: "session" })));
  const sdk = client();
  for (const params of [
    {},
    { enableWebMcp: false },
    { enableWebMcp: true },
  ] satisfies CreateSessionParams[]) {
    await sdk.sessions.create(params);
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual(params);
  }
  expectTypeOf<WebMCPTool["backendNodeId"]>().toEqualTypeOf<number | undefined>();
  expectTypeOf<
    Awaited<ReturnType<typeof sdk.sessions.webmcp.start>>
  >().toEqualTypeOf<WebMCPInvocation>();
});

test("discovers full tool metadata without rewriting schema or source keys", async () => {
  const discovery = {
    nativeSupported: true,
    truncated: true,
    tools: [
      {
        toolRef: "document-tool",
        name: "search",
        description: "Search",
        declarative: true,
        backendNodeId: 123,
        inputSchema: { type: "object", properties: { user_query: { type: "string" } } },
        outputSchema: { type: "object" },
        annotations: {
          readOnly: true,
          untrustedContent: true,
          consequential: false,
          autosubmit: false,
          openWorld: true,
        },
        source: {
          provider: "native",
          tabId: "tab",
          pageUrl: "https://page.test",
          pageTitle: "Page",
          frame: { id: "frame", url: "https://page.test/frame", isMainFrame: false },
        },
      },
    ],
  };
  fetchMock.mockResolvedValueOnce(respond(discovery));
  expect(await client().sessions.webmcp.listTools("session /#")).toEqual(discovery);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://example.test/api/session/session%20%2F%23/webmcp/tools",
    expect.objectContaining({ timeout: 40_000 })
  );
});

test("invokes once and preserves arbitrary JSON inputs and outputs", async () => {
  fetchMock.mockResolvedValueOnce(respond(result));
  const params = {
    toolRef: "document-tool",
    input: { snake_key: { CamelKey: null } },
    timeoutSeconds: 120,
  };
  expect(await client().sessions.webmcp.invoke("session", params)).toEqual(result);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://example.test/api/session/session/webmcp/invoke",
    expect.objectContaining({ method: "POST", body: JSON.stringify(params), timeout: 155_000 })
  );
});

test("starts, polls through pending states, and cancels without invoking again", async () => {
  const sdk = client();
  fetchMock
    .mockResolvedValueOnce(respond(handle, 202))
    .mockResolvedValueOnce(respond({ ...handle, status: "awaiting_submission" }))
    .mockResolvedValueOnce(
      respond({ ...handle, status: "completed", result, cancellationRequested: true })
    );
  const started = await sdk.sessions.webmcp.start("session", {
    toolRef: "document-tool",
    timeoutSeconds: 3600,
  });
  expect(started.status).toBe("running");
  expect(fetchMock.mock.lastCall![1].timeout).toBe(40_000);
  const pending = await sdk.sessions.webmcp.getResult("session", started.invocationId, {
    waitSeconds: 30,
  });
  expect(pending.status).toBe("awaiting_submission");
  expect(fetchMock.mock.lastCall![0]).toBe(
    `https://example.test/api/session/session/webmcp/invocations/${id}?waitSeconds=30`
  );
  expect(fetchMock.mock.lastCall![1].timeout).toBe(50_000);
  const canceled = await sdk.sessions.webmcp.cancel("session", started.invocationId);
  expect(canceled.status).toBe("completed"); // Completion may win cancellation.
  expect(canceled.result).toEqual(result);
  expect(fetchMock.mock.lastCall![0]).toBe(
    `https://example.test/api/session/session/webmcp/invocations/${id}/cancel`
  );
  expect(fetchMock.mock.lastCall![1].method).toBe("POST");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test.each(["invoke", "start", "cancel"] as const)(
  "%s does not retry network or transient API errors",
  async (method) => {
    for (const failure of ["network", "api"]) {
      fetchMock.mockReset();
      if (failure === "network")
        fetchMock.mockRejectedValue(
          Object.assign(new Error("socket lost"), { code: "ECONNRESET" })
        );
      else
        fetchMock.mockImplementation(() =>
          Promise.resolve(
            respond({ code: "outcome_unknown", message: "Unknown outcome", invocationId: id }, 504)
          )
        );
      const sdk = client().sessions.webmcp;
      const request =
        method === "cancel"
          ? sdk.cancel("session", id)
          : sdk[method]("session", { toolRef: "document-tool" });
      await expect(request).rejects.toMatchObject(
        failure === "api"
          ? {
              code: "outcome_unknown",
              details: { invocationId: id },
              statusCode: 504,
            }
          : { retryable: true }
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  }
);

test("result GET retries safely and exposes expired handles", async () => {
  fetchMock
    .mockResolvedValueOnce(respond({ message: "busy" }, 503))
    .mockResolvedValueOnce(respond(handle));
  expect(await client().sessions.webmcp.getResult("session", id)).toEqual(handle);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(
    respond({ code: "invocation_not_found", message: "Expired" }, 404)
  );
  await expect(client().sessions.webmcp.getResult("session", id)).rejects.toMatchObject({
    code: "invocation_not_found",
    statusCode: 404,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("retains truncation and form handles without fabricating output", async () => {
  for (const payload of [
    { ...result, output: null },
    {
      ...result,
      output: undefined,
      outputTruncated: true,
      outputBytes: 2_000_000,
      outputPreview: "preview",
    },
    { ...result, output: undefined, status: "awaiting_submission", invocationId: id },
    { ...result, output: undefined, status: "error", errorText: "Page error" },
  ]) {
    fetchMock.mockResolvedValueOnce(respond(payload));
    expect(await client().sessions.webmcp.invoke("session", { toolRef: "document-tool" })).toEqual(
      JSON.parse(JSON.stringify(payload))
    );
  }
});

test("respects a larger client timeout without mutating it", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond(handle)));
  const sdk = client(200_000).sessions.webmcp;
  await sdk.listTools("s");
  await sdk.invoke("s", { toolRef: "t" });
  await sdk.start("s", { toolRef: "t" });
  await sdk.getResult("s", id, { waitSeconds: 30 });
  await sdk.cancel("s", id);
  expect(fetchMock.mock.calls.every(([, init]) => init.timeout === 200_000)).toBe(true);
});

test("rejects invalid time budgets and input before sending a request", async () => {
  const sdk = client().sessions.webmcp;
  for (const timeoutSeconds of [0, 121, 1.5, NaN])
    await expect(sdk.invoke("s", { toolRef: "t", timeoutSeconds })).rejects.toBeInstanceOf(
      RangeError
    );
  for (const timeoutSeconds of [0, 3601])
    await expect(sdk.start("s", { toolRef: "t", timeoutSeconds })).rejects.toBeInstanceOf(
      RangeError
    );
  for (const waitSeconds of [-1, 31, 0.1])
    await expect(sdk.getResult("s", id, { waitSeconds })).rejects.toBeInstanceOf(RangeError);
  await expect(sdk.invoke("s", { toolRef: "" })).rejects.toBeInstanceOf(TypeError);
  // @ts-expect-error Tool inputs must be objects, not arrays.
  await expect(sdk.start("s", { toolRef: "t", input: [] })).rejects.toBeInstanceOf(TypeError);
  expect(fetchMock).not.toHaveBeenCalled();
});
