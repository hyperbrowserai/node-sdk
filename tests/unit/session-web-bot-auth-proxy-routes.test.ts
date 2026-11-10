import fs from "fs";
import os from "os";
import path from "path";
import { Readable, Writable } from "stream";
import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { Response } from "node-fetch";

const fetchMock = vi.fn();
// Lets a test wrap the fs stream the SDK opens for a path upload.
const fsHooks = vi.hoisted(() => ({
  wrapReadStream: undefined as undefined | ((stream: NodeJS.ReadableStream) => void),
}));
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const createReadStream = ((...args: Parameters<typeof actual.createReadStream>) => {
    const stream = actual.createReadStream(...args);
    fsHooks.wrapReadStream?.(stream);
    return stream;
  }) as typeof actual.createReadStream;
  return { ...actual, default: { ...actual, createReadStream }, createReadStream };
});
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

// Consumes the body the way node-fetch 2 does: `body.pipe(req)` with no error
// listener of its own, and a rejection when the signal aborts. An unlistened
// FormData "error" therefore surfaces as an uncaught exception, which vitest
// reports as a failed run.
const pipeLikeNodeFetch = () =>
  fetchMock.mockImplementationOnce(
    (_url: string, init: { body: NodeJS.ReadableStream; signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
        init.body.pipe(sink);
        sink.on("finish", () => resolve(respond({ message: "uploaded" })));
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The user aborted a request."), { name: "AbortError" }))
        );
      })
  );

const failingStream = (message: string) => {
  let sent = false;
  return new Readable({
    read() {
      if (sent) {
        setImmediate(() => this.destroy(new Error(message)));
        return;
      }
      sent = true;
      this.push("partial");
    },
  });
};

test("uploadFile rejects a missing or unreadable path before sending anything", async () => {
  const sdk = client();
  const missingPath = path.join(os.tmpdir(), `hb-missing-${Date.now()}-${Math.random()}.txt`);
  await expect(sdk.sessions.uploadFile("session-1", { fileInput: missingPath })).rejects.toThrow(
    `File not found: ${missingPath}`
  );

  const lockedFile = path.join(os.tmpdir(), `hb-locked-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(lockedFile, "secret");
  fs.chmodSync(lockedFile, 0o000);
  try {
    // root can read anything, so only check the EACCES path when it applies.
    if (process.getuid?.() !== 0) {
      await expect(sdk.sessions.uploadFile("session-1", { fileInput: lockedFile })).rejects.toThrow(
        `Permission denied accessing file: ${lockedFile}`
      );
    }
  } finally {
    fs.rmSync(lockedFile, { force: true });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("uploadFile rejects, aborts the request, and does not crash when a file path stream fails", async () => {
  const sdk = client();
  const tempFile = path.join(os.tmpdir(), `hb-upload-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(tempFile, "hello");
  // Fail the real fs stream the SDK opens, after its checks pass.
  fsHooks.wrapReadStream = (stream) =>
    stream.once("open", () =>
      setImmediate(() => (stream as fs.ReadStream).destroy(new Error("disk read failure")))
    );
  pipeLikeNodeFetch();
  try {
    await expect(sdk.sessions.uploadFile("session-1", { fileInput: tempFile })).rejects.toThrow(
      `Failed to read file at ${tempFile}: disk read failure`
    );
    expect(fetchMock.mock.lastCall![1].signal.aborted).toBe(true);
  } finally {
    fsHooks.wrapReadStream = undefined;
    fs.rmSync(tempFile, { force: true });
  }
});

test("uploadFile rejects, aborts the request, and does not crash when a caller's stream fails", async () => {
  const sdk = client();
  const stream = failingStream("upstream reset");
  pipeLikeNodeFetch();
  await expect(
    sdk.sessions.uploadFile("session-1", { fileInput: stream as any, fileName: "data.bin" })
  ).rejects.toThrow("Failed to read file stream data.bin: upstream reset");
  expect(fetchMock.mock.lastCall![1].signal.aborted).toBe(true);
});

test("uploadFile still uploads Buffers and healthy streams", async () => {
  const sdk = client();
  pipeLikeNodeFetch();
  await expect(
    sdk.sessions.uploadFile("session-1", { fileInput: Buffer.from("hi"), fileName: "a.txt" })
  ).resolves.toEqual({ message: "uploaded" });
  pipeLikeNodeFetch();
  await expect(
    sdk.sessions.uploadFile("session-1", { fileInput: Readable.from(["x"]) as any, fileName: "b.txt" })
  ).resolves.toEqual({ message: "uploaded" });
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
