import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});

import { HyperbrowserClient as Hyperbrowser, HyperbrowserError } from "../../src/client";
import { WebsiteExtractTool } from "../../src/tools";
import type {
  CreateSessionParams,
  ProxyRoute,
  SessionLaunchState,
  SessionWebBotAuth,
  WebBotAuthParams,
} from "../../src/types";

const client = () => new Hyperbrowser({ apiKey: "test-key", baseUrl: "https://example.test" });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lastBody = () => JSON.parse(fetchMock.mock.lastCall![1].body);

afterEach(() => fetchMock.mockReset());

test("session creation sends webBotAuth as given", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ id: "session" })));
  const sdk = client();
  for (const params of [
    {},
    { webBotAuth: true },
    { webBotAuth: false },
    { webBotAuth: { onlyDomains: ["example.com", "shop.example.org"] } },
  ] satisfies CreateSessionParams[]) {
    await sdk.sessions.create(params);
    expect(lastBody()).toEqual(params);
  }
});

test("session creation sends proxyRoutes in order", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ id: "session" })));
  const params = {
    useProxy: true,
    proxyRoutes: [
      { match: "api.example.com", proxy: "default" },
      { match: ["*.example.com", "cdn.example.net"], proxy: "direct" },
    ],
  } satisfies CreateSessionParams;
  await client().sessions.create(params);
  expect(lastBody()).toEqual(params);
});

test("agent tasks pass webBotAuth through sessionOptions", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(respond({ jobId: "job" })));
  await client().agents.browserUse.start({
    task: "Open example.com",
    sessionOptions: { webBotAuth: { onlyDomains: ["example.com"] } },
  });
  expect(fetchMock.mock.lastCall![0]).toBe("https://example.test/api/task/browser-use");
  expect(lastBody().sessionOptions).toEqual({ webBotAuth: { onlyDomains: ["example.com"] } });
});

test("public types describe the options and the signing launch state", () => {
  expectTypeOf<CreateSessionParams["webBotAuth"]>().toEqualTypeOf<
    boolean | WebBotAuthParams | undefined
  >();
  expectTypeOf<CreateSessionParams["proxyRoutes"]>().toEqualTypeOf<ProxyRoute[] | undefined>();
  expectTypeOf<ProxyRoute["proxy"]>().toEqualTypeOf<"direct" | "default">();
  expectTypeOf<ProxyRoute["match"]>().toEqualTypeOf<string | string[]>();
  expectTypeOf<SessionLaunchState["webBotAuth"]>().toEqualTypeOf<SessionWebBotAuth | undefined>();
  expectTypeOf<SessionWebBotAuth>().toEqualTypeOf<{
    signatureAgent: string;
    onlyDomains?: string[];
  }>();
});

test("uploadFile rejects with HyperbrowserError for a non-existent file path and on stream errors without crashing", async () => {
  const sdk = client();
  const missingPath = path.join(os.tmpdir(), `hb-missing-${Date.now()}-${Math.random()}.txt`);

  await expect(
    sdk.sessions.uploadFile("session-1", { fileInput: missingPath })
  ).rejects.toThrowError(HyperbrowserError);
  expect(fetchMock).not.toHaveBeenCalled();

  const tempFile = path.join(os.tmpdir(), `hb-upload-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(tempFile, "hello");
  try {
    fetchMock.mockImplementationOnce(async (_url: string, init: { body?: any }) => {
      // Simulate a stream error after fs.stat/fs.access succeed while the request is in flight
      const streams = (init?.body?._streams ?? []).filter(
        (entry: unknown) =>
          entry && typeof entry === "object" && typeof (entry as any).emit === "function"
      );
      if (streams[0]) {
        streams[0].emit("error", new Error("disk read failure"));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return respond({ message: "uploaded" });
    });

    await expect(
      sdk.sessions.uploadFile("session-1", { fileInput: tempFile })
    ).rejects.toThrowError(
      new HyperbrowserError(`Failed to read file at ${tempFile}: disk read failure`, undefined)
    );
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
});

test("WebsiteExtractTool.runnable parses a JSON string schema without mutating the caller's params", async () => {
  const sdk = client();
  const startAndWaitSpy = vi
    .spyOn(sdk.extract, "startAndWait")
    .mockResolvedValue({ jobId: "ext-1", status: "completed", data: { title: "Example" } });

  const params = {
    urls: ["https://example.com"],
    schema: '{"type":"object","properties":{"title":{"type":"string"}}}',
  };

  const result = await WebsiteExtractTool.runnable(sdk, params);
  expect(result).toBe('{"title":"Example"}');
  expect(params.schema).toBe('{"type":"object","properties":{"title":{"type":"string"}}}');
  expect(startAndWaitSpy).toHaveBeenCalledWith({
    urls: ["https://example.com"],
    schema: { type: "object", properties: { title: { type: "string" } } },
  });
});
