import { afterEach, expect, test } from "vitest";
import fixtures from "../fixtures/python_sse_reference.json";
import { RuntimeTransport } from "../../src/sandbox/base";
import { localHTTP } from "../helpers/local-http";
// Golden decoding results captured from Python SDK 1.9.1 (c36d3d9).
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
test.each(fixtures)("Python SSE decoding: $name", async (fixture) => {
  const server = await localHTTP(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of fixture.chunks) {
      res.write(Buffer.from(chunk, "hex"));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    res.end();
  });
  cleanup.push(server.close);
  const transport = new RuntimeTransport(
    async () => ({ sandboxId: "s", baseUrl: server.url, token: "local" }),
    2000
  );
  const received = [];
  for await (const event of transport.streamSSE("/stream"))
    received.push({ ...event, id: event.id ?? null });
  expect(received).toEqual(fixture.expected);
});
