import { afterEach, expect, test } from "vitest";
import fixtures from "../fixtures/python_wire_reference.json";
import { HyperbrowserClient } from "../../src/client";
import { RuntimeTransport } from "../../src/sandbox/base";
import { SandboxFilesApi } from "../../src/sandbox/files";
import { SandboxProcessesApi, SandboxProcessHandle } from "../../src/sandbox/process";
import { SandboxTerminalApi, SandboxTerminalHandle } from "../../src/sandbox/terminal";
import { localHTTP } from "../helpers/local-http";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function expectedValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expectedValues);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "modifiedTime" && typeof item === "string" ? new Date(item) : expectedValues(item),
      ])
    );
  return value;
}

test.each(fixtures)("Python HTTP contract: $name", async (fixture) => {
  const requests: unknown[] = [];
  const server = await localHTTP(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url!, "http://fixture.test");
    const expected = fixture.requests[requests.length];
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(
        [...url.searchParams.keys()].map((key) => [key, url.searchParams.getAll(key)])
      ),
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(expected?.reply ?? {}));
  });
  cleanup.push(server.close);
  const client = new HyperbrowserClient({ apiKey: "local", baseUrl: server.url, timeout: 2000 });
  const connection = { sandboxId: "s", baseUrl: server.url, token: "local" };
  const transport = new RuntimeTransport(async () => connection, 2000);
  const files = new SandboxFilesApi(transport, async () => connection);
  const subjects: Record<string, unknown> = {
    sandboxes: client.sandboxes,
    volumes: client.volumes,
    processes: new SandboxProcessesApi(transport),
    terminal: new SandboxTerminalApi(transport, async () => connection),
    processHandle: new SandboxProcessHandle(transport, {
      id: "proc_1",
      command: "bash",
      cwd: "/tmp",
      status: "running",
      startedAt: 1,
    }),
    terminalHandle: new SandboxTerminalHandle(transport, async () => connection, {
      id: "pty_1",
      command: "bash",
      cwd: "/tmp",
      rows: 24,
      cols: 80,
      running: true,
      startedAt: 1,
    }),
    files,
    filesRoot: files.withRunAs("root"),
  };
  const subject = subjects[fixture.subject] as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  let result = await subject[fixture.nodeMethod](...fixture.nodeArgs);
  if (result && typeof (result as { toJSON?: unknown }).toJSON === "function")
    result = (result as { toJSON(): unknown }).toJSON();
  if (fixture.expectedResult === null) expect(result).toBeUndefined();
  else if (typeof fixture.expectedResult === "object")
    expect(result).toMatchObject(expectedValues(fixture.expectedResult) as object);
  else expect(result).toEqual(fixture.expectedResult);
  // Python capitalizes booleans; the receiver accepts both forms. Node avoids
  // Python's redundant detail GET when expose already returned an explicit URL.
  const expected = fixture.requests
    .filter((_request, i) => !(fixture.nodeMethod === "expose" && i > 0))
    .map(({ reply: _reply, ...request }) => ({
      ...request,
      query: Object.fromEntries(
        Object.entries(request.query).map(([key, values]) => [
          key,
          values?.map((value) =>
            ["includeOutput", "includeEvents"].includes(key) ? value.toLowerCase() : value
          ),
        ])
      ),
    }));
  expect(requests).toEqual(expected);
});
