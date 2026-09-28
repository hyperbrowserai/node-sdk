import { afterEach, expect, test, vi } from "vitest";
import { HyperbrowserClient } from "../../src/client";
import { CreateSandboxParams } from "../../src/types";
import { localHTTP } from "../helpers/local-http";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.unstubAllEnvs();
});
const detail = {
  id: "s",
  teamId: "t",
  status: "active",
  region: "us",
  duration: 10,
  createdAt: "now",
  updatedAt: "now",
  sessionUrl: "url",
  runtime: { transport: "regional_proxy", host: "s.example.com", baseUrl: "https://s.example.com" },
  token: "token",
  tokenExpiresAt: null,
};
async function setup() {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const server = await localHTTP(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : undefined });
    if (req.url === "/api/sandbox/s/expose") res.end('{"port":8080,"auth":true}');
    else if (req.url?.startsWith("/api/volume"))
      res.end(
        JSON.stringify(
          req.url === "/api/volume" && req.method === "GET"
            ? { volumes: [{ id: "v", name: "n", size: "42", transferAmount: "" }], totalCount: "1" }
            : { id: "v", name: "n", size: "42", transferAmount: null }
        )
      );
    else
      res.end(
        JSON.stringify({
          ...detail,
          vcpus: "2",
          memMiB: "2048",
          diskSizeMiB: "",
          dataConsumed: "7",
          proxyDataConsumed: "",
          proxyBytesUsed: null,
          timeoutMinutes: "15",
        })
      );
  });
  cleanup.push(server.close);
  return {
    calls,
    url: server.url,
    client: new HyperbrowserClient({ apiKey: "local", baseUrl: server.url }),
  };
}
test.each([
  {},
  { imageName: "" },
  { imageName: "a", snapshotName: "b" },
  { imageId: "id" },
  { snapshotId: "id" },
  { snapshotName: "s", cpu: 2 },
  { imageName: "a", cpu: NaN },
  { imageName: "a", diskMiB: 1.5 },
])("invalid launch never reaches the server: %j", async (params) => {
  const api = await setup();
  await expect(api.client.sandboxes.create(params as CreateSandboxParams)).rejects.toThrow();
  expect(api.calls).toHaveLength(0);
});
test("snapshot startup and runtime auth reuse the existing lifecycle", async () => {
  const api = await setup();
  const sandbox = await api.client.sandboxes.startFromSnapshot({
    snapshotName: "snap",
    snapshotId: "id",
    timeoutMinutes: 5,
  });
  expect(api.calls[0].body).toEqual({ snapshotName: "snap", snapshotId: "id", timeoutMinutes: 5 });
  const session = await sandbox.createRuntimeSession();
  session.runtime.host = "mutated";
  expect((await sandbox.createRuntimeSession()).runtime.host).toBe("s.example.com");
  expect(api.calls).toHaveLength(1);
  await sandbox.createRuntimeSession({ forceRefresh: true });
  expect(api.calls).toHaveLength(2);
  expect((await api.client.sandboxes.getRuntimeSession("s")).token).toBe("token");
});
test("exposure URL fallback uses the handle's cached runtime", async () => {
  const api = await setup();
  const sandbox = await api.client.sandboxes.get("s");
  expect((await sandbox.expose({ port: 8080 })).url).toBe("https://8080-s.example.com/");
  expect(api.calls).toHaveLength(2);
  expect((await api.client.sandboxes.expose("s", { port: 8080 })).url).toBe(
    "https://8080-s.example.com/"
  );
  expect(api.calls).toHaveLength(4);
});
test("sandbox and volume numeric strings, empty values, and absent tokens normalize", async () => {
  const api = await setup();
  const sandbox = await api.client.sandboxes.get("s");
  expect(sandbox.toJSON()).toMatchObject({
    cpu: 2,
    memoryMiB: 2048,
    diskMiB: null,
    dataConsumed: 7,
    proxyDataConsumed: null,
    proxyBytesUsed: null,
    exposedPorts: [],
    creditsUsed: null,
  });
  expect(await api.client.volumes.get("v")).toEqual({
    id: "v",
    name: "n",
    size: 42,
    transferAmount: null,
  });
  expect(await api.client.volumes.list()).toMatchObject({
    totalCount: 1,
    volumes: [{ size: 42, transferAmount: null }],
  });
});
test("environment base URL is honored and explicit config wins", async () => {
  const api = await setup();
  vi.stubEnv("HYPERBROWSER_BASE_URL", api.url);
  await new HyperbrowserClient({ apiKey: "local" }).sandboxes.get("s");
  vi.stubEnv("HYPERBROWSER_BASE_URL", "http://invalid.test");
  await new HyperbrowserClient({ apiKey: "local", baseUrl: api.url }).sandboxes.get("s");
  expect(api.calls).toHaveLength(2);
});
