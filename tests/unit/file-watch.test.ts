import { afterEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { SandboxFilesApi } from "../../src/sandbox/files";
import { RuntimeTransport } from "../../src/sandbox/base";
import { openRuntimeWebSocket } from "../../src/sandbox/ws";
import { localHTTP, delay } from "../helpers/local-http";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const status = {
  id: "w",
  path: "/tmp",
  recursive: true,
  active: true,
  createdAt: 1,
  oldestSeq: 0,
  lastSeq: 0,
  eventCount: 0,
};
async function setup(done: boolean) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const server = await localHTTP(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method!, path: req.url!, body: body ? JSON.parse(body) : undefined });
    res.end(
      JSON.stringify({
        watch: {
          ...status,
          ...(req.url?.includes("includeEvents")
            ? { events: [{ seq: 3, path: "/tmp/a", op: "WRITE", timestamp: 2 }], lastSeq: 3 }
            : {}),
        },
      })
    );
  });
  const ws = new WebSocketServer({ server: server.server });
  const targets: string[] = [];
  ws.on("connection", (socket, request) => {
    targets.push(request.url!);
    socket.send(
      JSON.stringify({
        type: "event",
        event: { seq: 4, path: "/tmp/a", op: "WRITE", timestamp: 3 },
      })
    );
    if (done)
      socket.send(
        JSON.stringify({
          type: "done",
          status: { ...status, active: false, lastSeq: 4, stoppedAt: 4 },
        })
      );
  });
  cleanup.push(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await server.close();
  });
  const connection = { sandboxId: "s", baseUrl: server.url, token: "test" };
  const transport = new RuntimeTransport(async () => connection, 1000);
  return { calls, targets, ws, files: new SandboxFilesApi(transport, async () => connection) };
}
test("low-level watch resumes by ID/cursor, refreshes events, and yields done status", async () => {
  const api = await setup(true);
  const watch = await api.files.getWatch("w", true);
  expect(watch.current.events?.[0].seq).toBe(3);
  const copy = watch.current;
  copy.events![0].seq = 99;
  expect(watch.current.events![0].seq).toBe(3);
  const messages = [];
  for await (const message of watch.events({ cursor: 3, route: "stream" })) messages.push(message);
  expect(messages.map((message) => message.type)).toEqual(["event", "done"]);
  expect(watch.current).toMatchObject({ active: false, lastSeq: 4, stoppedAt: 4 });
  expect(api.targets[0]).toContain("/stream?sessionId=s&cursor=3");
  await watch.refresh(true);
  expect(watch.toJSON().events?.[0].seq).toBe(3);
  expect(api.calls.map((call) => call.path)).toEqual([
    "/sandbox/files/watch/w?includeEvents=true",
    "/sandbox/files/watch/w?includeEvents=true",
  ]);
});
test("breaking watch iteration releases the WebSocket", async () => {
  const api = await setup(false);
  const watch = await api.files.withRunAs("root").watch("/tmp", { recursive: true });
  for await (const message of watch.events()) {
    expect(message.type).toBe("event");
    // Match the receiver and Python: oldestSeq=0 is an empty-buffer sentinel.
    expect(watch.current.oldestSeq).toBe(4);
    break;
  }
  await delay(20);
  expect(api.ws.clients.size).toBe(0);
  expect(api.calls[0].body).toEqual({ path: "/tmp", recursive: true, runAs: "root" });
  await watch.stop();
  expect(watch.current.active).toBe(false);
  expect(api.calls[1].method).toBe("DELETE");
});
test("callback watch receives file events and ends cleanly on a done envelope", async () => {
  const api = await setup(true);
  const events: unknown[] = [];
  let exited!: (error?: Error) => void;
  const exit = new Promise<Error | undefined>((resolve) => (exited = resolve));
  await api.files.watchDir(
    "/tmp",
    (event) => {
      events.push(event);
    },
    { onExit: exited }
  );
  expect(await exit).toBeUndefined();
  expect(events).toEqual([{ type: "write", name: "a" }]);
});
test("watch iteration supports caller cancellation", async () => {
  const api = await setup(false);
  const watch = await api.files.watch("/tmp");
  const controller = new AbortController();
  const events = watch.events({ signal: controller.signal });
  await events.next();
  controller.abort();
  await expect(events.next()).rejects.toMatchObject({ code: "request_aborted" });
  await delay(20);
  expect(api.ws.clients.size).toBe(0);
});

test("watch cancellation also interrupts a stalled WebSocket handshake", async () => {
  const server = await localHTTP((_req, res) => res.end(JSON.stringify({ watch: status })));
  server.server.on("upgrade", () => {});
  cleanup.push(server.close);
  const connection = { sandboxId: "s", baseUrl: server.url, token: "test" };
  const files = new SandboxFilesApi(
    new RuntimeTransport(async () => connection),
    async () => connection
  );
  const watch = await files.getWatch("w");
  const controller = new AbortController();
  const next = watch.events({ signal: controller.signal }).next();
  const rejected = expect(next).rejects.toMatchObject({
    code: "request_aborted",
    retryable: false,
  });
  await delay(20);
  controller.abort();
  await rejected;
});

test("a stalled rejected handshake body respects the connection deadline", async () => {
  const server = await localHTTP((_req, res) => {
    res.writeHead(403);
    res.write("{");
  });
  cleanup.push(server.close);
  await expect(
    openRuntimeWebSocket({ url: server.url.replace("http:", "ws:") }, {}, { timeoutMs: 40 })
  ).rejects.toMatchObject({ code: "request_timeout", service: "runtime" });
});

test("a callback can stop its own watcher without waiting on itself", async () => {
  const api = await setup(false);
  let exited!: () => void;
  const exit = new Promise<void>((resolve) => {
    exited = resolve;
  });
  const handle = await api.files.watchDir(
    "/tmp",
    async () => {
      await handle.stop();
    },
    { onExit: exited }
  );
  await exit;
  await delay(20);
  expect(api.ws.clients.size).toBe(0);
});

test("terminal attachment preserves frames sent with the HTTP upgrade", async () => {
  const { SandboxTerminalHandle } = await import("../../src/sandbox/terminal");
  const server = await localHTTP((_req, res) => res.end());
  const ws = new WebSocketServer({ server: server.server });
  const status = {
    id: "p",
    command: "sh",
    cwd: "/tmp",
    running: false,
    rows: 24,
    cols: 80,
    startedAt: 1,
    exitCode: 0,
  };
  ws.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "output",
        seq: 1,
        data: Buffer.from("first").toString("base64"),
        timestamp: 1,
      })
    );
    socket.send(JSON.stringify({ type: "exit", status }));
    socket.close();
  });
  cleanup.push(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await server.close();
  });
  const connection = { sandboxId: "s", baseUrl: server.url, token: "t" };
  const handle = new SandboxTerminalHandle(
    new RuntimeTransport(async () => connection),
    async () => connection,
    status
  );
  const terminal = await handle.attach(0);
  const events = [];
  for await (const event of terminal.events()) events.push(event);
  expect(events.map((event) => event.type)).toEqual(["output", "exit"]);
  expect(events[0]).toMatchObject({ data: "first" });
});
