import { afterEach, describe, expect, test } from "vitest";
import { RuntimeTransport } from "../../src/sandbox/base";
import { SandboxProcessesApi } from "../../src/sandbox/process";
import { SandboxFilesApi } from "../../src/sandbox/files";
import { BaseService } from "../../src/services/base";
import { delay, localHTTP } from "../helpers/local-http";

const started =
  'event: started\ndata: {"id":"p","status":"running","command":"sleep 300","cwd":"/tmp","started_at":1}\n\n';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(handler: Parameters<typeof localHTTP>[0], timeout = 1000) {
  const server = await localHTTP(handler);
  cleanup.push(server.close);
  let refreshes = 0;
  const connection = { sandboxId: "s", token: "local", baseUrl: server.url };
  const transport = new RuntimeTransport(async (refresh) => {
    if (refresh) refreshes++;
    return connection;
  }, timeout);
  return {
    ...server,
    transport,
    files: new SandboxFilesApi(transport, async () => connection),
    processes: new SandboxProcessesApi(transport),
    refreshes: () => refreshes,
  };
}
describe("runtime HTTP lifetime", () => {
  test("CR-only events are delivered before the response ends", async () => {
    const api = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(started.replace(/\n/g, "\r"));
    });
    const stream = await api.transport.openSSE("/stream", undefined, { idleTimeoutMs: 100 });
    try {
      expect((await stream.events.next()).value?.event).toBe("started");
    } finally {
      stream.close();
    }
  });
  test("disconnect releases the actual process socket", async () => {
    let closed = false;
    const api = await setup((_req, res) => {
      res.on("close", () => (closed = true));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(started);
    });
    const handle = await api.processes.start("sleep 300");
    handle.disconnect();
    await expect(handle.wait()).rejects.toMatchObject({ code: "incomplete_output" });
    await delay(25);
    expect(closed).toBe(true);
    expect(api.sockets.size).toBe(0);
  });
  test("idle timeout rejects instead of completing and releases its socket", async () => {
    const api = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(started);
    });
    const stream = await api.transport.openSSE("/processes", undefined, {
      method: "POST",
      idleTimeoutMs: 20,
    });
    expect((await stream.events.next()).value?.event).toBe("started");
    await expect(stream.events.next()).rejects.toMatchObject({
      code: "stream_idle_timeout",
      method: "POST",
      path: "/processes",
      statusCode: 200,
    });
    await delay(20);
    expect(api.sockets.size).toBe(0);
  });
  test("heartbeats reset the idle budget and split UTF-8 is preserved", async () => {
    const api = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const data = Buffer.from('event: output\ndata: {"data":"€"}\n\n');
      const split = data.indexOf(Buffer.from("€")) + 1;
      res.write(data.subarray(0, split));
      setTimeout(() => res.write(data.subarray(split)), 10);
      const timer = setInterval(() => res.write(": ping\n\n"), 10);
      setTimeout(() => {
        clearInterval(timer);
        res.end();
      }, 70);
      res.once("close", () => clearInterval(timer));
    });
    const stream = await api.transport.openSSE("/stream", undefined, { idleTimeoutMs: 35 });
    const events = [];
    for await (const event of stream.events) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ data: "€" });
  });
  test("AbortSignal cancels collection without another process POST", async () => {
    let starts = 0;
    const api = await setup((_req, res) => {
      starts++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(started);
    });
    const controller = new AbortController();
    const handle = await api.processes.start("sleep 300", { signal: controller.signal });
    controller.abort();
    await expect(handle.wait()).rejects.toMatchObject({
      code: "request_aborted",
      retryable: false,
    });
    await delay(20);
    expect(starts).toBe(1);
    expect(api.sockets.size).toBe(0);
  });
  test("JSON-only receivers are rejected without a repeated command or socket leak", async () => {
    let starts = 0;
    const api = await setup((_req, res) => {
      starts++;
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"process":');
    });
    await expect(api.processes.start("echo hi")).rejects.toMatchObject({
      code: "streaming_not_supported",
    });
    await delay(20);
    expect(starts).toBe(1);
    expect(api.sockets.size).toBe(0);
  });
  test("normal response body reads have a deadline after headers", async () => {
    const api = await setup((_req, res) => {
      res.writeHead(200);
      res.write('{"partial":');
    }, 25);
    await expect(api.transport.requestJSON("/files/read")).rejects.toMatchObject({
      service: "runtime",
      retryable: true,
    });
  });
  test("empty successful chunked responses return an empty object", async () => {
    const api = await setup((_req, res) => {
      res.writeHead(200, { "transfer-encoding": "chunked" });
      res.end();
    });
    expect(await api.transport.requestJSON("/files/delete", { method: "POST" })).toEqual({});
  });
  test("401 refresh closes the replaced response before retrying", async () => {
    let count = 0;
    let firstClosed = false;
    const api = await setup((_req, res) => {
      count++;
      if (count === 1) {
        res.on("close", () => (firstClosed = true));
        res.writeHead(401);
        res.write("expired");
      } else res.end('{"ok":true}');
    });
    expect(await api.transport.requestJSON("/stat")).toEqual({ ok: true });
    await delay(20);
    expect(firstClosed).toBe(true);
    expect(api.refreshes()).toBe(1);
  });
});

test("control body failures retain response context and caller cancellation", async () => {
  const api = await setup((_req, res) => {
    res.writeHead(200, { "x-request-id": "partial-response" });
    res.write("{");
  });
  class Service extends BaseService {
    read(signal: AbortSignal) {
      return this.request("/body?private=value", { signal });
    }
  }
  const controller = new AbortController();
  const pending = new Service("local", api.url, 1000).read(controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    code: "request_aborted",
    statusCode: 200,
    requestId: "partial-response",
    method: "GET",
    path: "/body",
    retryable: false,
    service: "control",
  });
  await delay(25);
  controller.abort();
  await rejected;
});

test("runtime HTTP errors include method and query-free path context", async () => {
  const api = await setup((_req, res) => {
    res.writeHead(409, { "x-request-id": "conflict" });
    res.end(JSON.stringify({ code: "conflict", message: "Cannot move" }));
  });
  await expect(
    api.transport.requestJSON("/files/move?private=value", { method: "POST", body: "{}" })
  ).rejects.toMatchObject({
    statusCode: 409,
    requestId: "conflict",
    method: "POST",
    path: "/files/move",
  });
});
describe("true file streaming", () => {
  test("downloads expose chunks before EOF and break releases the connection", async () => {
    let closed = false;
    let url = "";
    const api = await setup((req, res) => {
      url = req.url!;
      res.on("close", () => (closed = true));
      res.write(Buffer.alloc(128 * 1024, 7));
    });
    for await (const chunk of api.files.withRunAs("root").downloadStream("/large")) {
      expect(chunk[0]).toBe(7);
      break;
    }
    await delay(20);
    expect(closed).toBe(true);
    expect(url).toContain("runAs=root");
  });
  test("uploads are pull-based and preserve content length and runAs", async () => {
    let firstRead!: () => void;
    const first = new Promise<void>((resolve) => (firstRead = resolve));
    let bytes = 0;
    let url = "";
    let length = "";
    const api = await setup((req, res) => {
      url = req.url!;
      length = req.headers["content-length"]!;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        firstRead();
      });
      req.on("end", () => res.end(JSON.stringify({ path: "/large", bytesWritten: bytes })));
    });
    const size = 20 * 1024 * 1024;
    async function* source() {
      yield Buffer.alloc(65536);
      await first;
      for (let i = 65536; i < size; i += 65536) yield Buffer.alloc(65536);
    }
    expect(
      await api.files.withRunAs("root").uploadStream("/large", source(), { contentLength: size })
    ).toEqual({ path: "/large", bytesWritten: size });
    expect(length).toBe(String(size));
    expect(url).toContain("runAs=root");
  });
  test("a streamed upload receiving 401 is never replayed", async () => {
    let requests = 0;
    let released = false;
    const api = await setup((req, res) => {
      requests++;
      req.once("data", () => {
        res.writeHead(401);
        res.end("expired");
      });
    });
    async function* source() {
      try {
        for (let i = 0; i < 100; i++) {
          yield Buffer.alloc(65536);
          await delay(2);
        }
      } finally {
        released = true;
      }
    }
    await expect(api.files.uploadStream("/large", source())).rejects.toMatchObject({
      code: "stream_not_replayable",
    });
    await delay(25);
    expect(requests).toBe(1);
    expect(api.refreshes()).toBe(0);
    expect(released).toBe(true);
  });
});

test("file aliases preserve operation payloads and overwrite false", async () => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const file = {
    path: "/b",
    name: "b",
    type: "file",
    size: 0,
    mode: 0,
    permissions: "",
    owner: "root",
    group: "root",
  };
  const api = await setup(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : undefined });
    res.end(JSON.stringify({ file, entry: file, created: true }));
  });
  const files = api.files.withRunAs("root");
  expect(await files.stat("/b")).toMatchObject({ name: "b" });
  expect(await files.mkdir("/b", { parents: true })).toBe(true);
  await files.rename("/a", "/b", { overwrite: false });
  await files.move({ source: "/b", destination: "/c", overwrite: true });
  await files.delete("/c", { recursive: true });
  expect(calls[0].url).toContain("runAs=root");
  expect(calls.slice(1).map((call) => call.body)).toEqual([
    { path: "/b", parents: true, runAs: "root" },
    { from: "/a", to: "/b", overwrite: false, runAs: "root" },
    { from: "/b", to: "/c", overwrite: true, runAs: "root" },
    { path: "/c", recursive: true, runAs: "root" },
  ]);
});

test.each([false, true])("heartbeats outlive ordinary request deadlines (refresh=%s)", async (refresh) => {
  let calls = 0;
  const api = await setup((_req, res) => {
    calls++;
    if (refresh && calls === 1) { res.writeHead(401); res.end("expired"); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(started);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15);
    const finish = setTimeout(() => res.end('event: done\ndata: {"last_seq":0}\n\n'), 150);
    res.once("close", () => { clearInterval(heartbeat); clearTimeout(finish); });
  }, 50);
  const stream = await api.transport.openSSE("/processes", undefined, { method: "POST", idleTimeoutMs: 100 });
  const events = [];
  for await (const event of stream.events) events.push(event.event);
  expect(events).toEqual(["started", "done"]);
  expect(calls).toBe(refresh ? 2 : 1);
  expect(api.refreshes()).toBe(refresh ? 1 : 0);
});
test("SSE response headers retain the ordinary deadline without replaying POST", async () => {
  let requests = 0;
  const api = await setup(() => { requests++; }, 30);
  await expect(api.transport.openSSE("/processes", undefined, { method: "POST" })).rejects.toMatchObject({ service: "runtime", method: "POST", retryable: true });
  await delay(15);
  expect(requests).toBe(1);
  expect(api.sockets.size).toBe(0);
});
test("canceling an upload releases its producer and socket without replay", async () => {
  const controller = new AbortController();
  let requests = 0; let released = false;
  const api = await setup((req) => { requests++; req.once("data", () => controller.abort()); });
  async function* chunks() {
    try { for (let i = 0; i < 1000; i++) { yield Buffer.alloc(32768); await delay(5); } }
    finally { released = true; }
  }
  await expect(api.files.uploadStream("/file", chunks(), { signal: controller.signal })).rejects.toMatchObject({ code: "request_aborted", retryable: false });
  await expect.poll(() => released, { timeout: 1000 }).toBe(true);
  await expect.poll(() => api.sockets.size, { timeout: 1000 }).toBe(0);
  expect(requests).toBe(1);
});
