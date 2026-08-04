import { describe, expect, test, vi, afterEach } from "vitest";
import { SandboxFilesApi } from "../../../src/sandbox/files";
import { SandboxTerminalHandle } from "../../../src/sandbox/terminal";
import * as wsModule from "../../../src/sandbox/ws";
import { SandboxesService } from "../../../src/services/sandboxes";
import type { SandboxExposeResult } from "../../../src/types";

const parseJsonRequestBody = (init: unknown): unknown => {
  if (!init || typeof init !== "object" || !("body" in init) || typeof init.body !== "string") {
    throw new TypeError("Expected a string request body");
  }
  return JSON.parse(init.body) as unknown;
};

const wireSandboxDetail = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "sbx_123",
  teamId: "team_1",
  status: "active",
  endTime: null,
  startTime: 123,
  createdAt: "2026-03-12T00:00:00Z",
  updatedAt: "2026-03-12T00:00:01Z",
  closeReason: null,
  dataConsumed: 1,
  proxyDataConsumed: 2,
  usageType: "sandbox",
  jobId: null,
  launchState: null,
  creditsUsed: 0.1,
  region: "us",
  sessionUrl: "https://example.com/session",
  duration: 10,
  proxyBytesUsed: 3,
  vcpus: 2,
  memMiB: 2048,
  diskSizeMiB: 8192,
  network: {
    allowInternetAccess: true,
    allowOut: [],
    denyOut: [],
  },
  runtime: {
    transport: "regional_proxy",
    host: "https://runtime.example.com",
    baseUrl: "https://runtime.example.com/sandbox/sbx_123",
  },
  exposedPorts: [],
  token: "runtime-token",
  tokenExpiresAt: "2026-03-12T12:00:00Z",
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sandbox control and runtime contract", () => {
  test("create forwards exposedPorts and mounts, then hydrates handle exposed ports", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const payload = wireSandboxDetail({
      exposedPorts: [
        {
          port: 3000,
          auth: true,
          url: "https://3000-sbx_123.runtime.example.com/",
          browserUrl: "https://3000-sbx_123.runtime.example.com/_hb/auth?grant=token&next=%2F",
          browserUrlExpiresAt: "2026-03-12T13:00:00Z",
        },
      ],
    });
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const sandbox = await service.create({
      imageName: "node",
      cpu: 8,
      memoryMiB: 8192,
      diskMiB: 10240,
      exposedPorts: [{ port: 3000, auth: true }],
      mounts: {
        "/workspace/cache": {
          id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
          type: "rw",
          shared: true,
        },
      },
    });

    expect(requestSpy).toHaveBeenCalledWith(
      "/sandbox",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      imageName: "node",
      exposedPorts: [{ port: 3000, auth: true }],
      mounts: {
        "/workspace/cache": {
          id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
          type: "rw",
          shared: true,
        },
      },
      vcpus: 8,
      memMiB: 8192,
      diskSizeMiB: 10240,
    });
    expect(sandbox.exposedPorts).toEqual(payload.exposedPorts as SandboxExposeResult[]);
    expect(sandbox.toJSON()).toMatchObject({
      cpu: 2,
      memoryMiB: 2048,
      diskMiB: 8192,
    });
    expect(sandbox.getExposedUrl(3000)).toBe("https://3000-sbx_123.runtime.example.com/");
  });

  test("create forwards mounts for snapshot launches", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireSandboxDetail());

    await service.create({
      snapshotName: "snapshot-1",
      mounts: {
        "/workspace/readonly": {
          id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
          type: "ro",
        },
      },
    });

    expect(requestSpy).toHaveBeenCalledWith(
      "/sandbox",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      snapshotName: "snapshot-1",
      mounts: {
        "/workspace/readonly": {
          id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
          type: "ro",
        },
      },
    });
  });

  test("create leaves resource value validation to the server", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireSandboxDetail());

    await service.create({
      imageName: "node",
      cpu: 0,
      memoryMiB: -1,
      diskMiB: 1.5,
    });

    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      imageName: "node",
      vcpus: 0,
      memMiB: -1,
      diskSizeMiB: 1.5,
    });
  });

  test("create treats an explicitly undefined imageName as a snapshot launch", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireSandboxDetail());

    await service.create({
      snapshotName: "snapshot-1",
      imageName: undefined,
    });

    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      snapshotName: "snapshot-1",
    });
  });

  test("create forwards network policy fields for image and snapshot launches", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireSandboxDetail());

    await service.create({
      imageName: "node",
      allowInternetAccess: false,
      allowOut: ["github.com"],
      denyOut: ["169.254.169.254"],
    });
    await service.create({
      snapshotName: "snapshot-1",
      allowInternetAccess: true,
      denyOut: ["10.0.0.0/8"],
    });

    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      imageName: "node",
      allowInternetAccess: false,
      allowOut: ["github.com"],
      denyOut: ["169.254.169.254"],
    });
    expect(parseJsonRequestBody(requestSpy.mock.calls[1][1])).toEqual({
      snapshotName: "snapshot-1",
      allowInternetAccess: true,
      denyOut: ["10.0.0.0/8"],
    });
  });

  test("updateNetwork sends a PUT patch and clearNetwork restores defaults", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const detailSpy = vi.spyOn(service as any, "request").mockResolvedValue(wireSandboxDetail());
    const sandbox = await service.get("sbx_123");
    detailSpy.mockResolvedValue({
      network: {
        allowInternetAccess: false,
        allowOut: ["github.com"],
        denyOut: [],
      },
    });

    const result = await sandbox.updateNetwork({
      allowInternetAccess: false,
      allowOut: ["github.com"],
    });

    expect(detailSpy).toHaveBeenLastCalledWith(
      "/sandbox/sbx_123/network",
      expect.objectContaining({ method: "PUT" })
    );
    expect(parseJsonRequestBody(detailSpy.mock.calls.at(-1)![1])).toEqual({
      allowInternetAccess: false,
      allowOut: ["github.com"],
    });
    expect(result.network.allowInternetAccess).toBe(false);
    expect(sandbox.network).toEqual(result.network);

    await sandbox.clearNetwork();
    expect(parseJsonRequestBody(detailSpy.mock.calls.at(-1)![1])).toEqual({
      allowInternetAccess: true,
      allowOut: [],
      denyOut: [],
    });
  });

  test("handles sandbox responses that omit network until a policy is updated", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const detail = wireSandboxDetail();
    delete detail.network;
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(detail);
    const sandbox = await service.get("sbx_123");

    expect(sandbox.network).toBeUndefined();

    requestSpy.mockResolvedValue({
      network: {
        allowInternetAccess: false,
        allowOut: [],
        denyOut: ["10.0.0.0/8"],
      },
    });
    await sandbox.updateNetwork({ denyOut: ["10.0.0.0/8"] });

    expect(sandbox.network).toEqual({
      allowInternetAccess: false,
      allowOut: [],
      denyOut: ["10.0.0.0/8"],
    });
  });

  test("treats close-error sandboxes as unavailable at runtime", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    vi.spyOn(service as any, "request").mockResolvedValue(
      wireSandboxDetail({ status: "close-error" })
    );
    const sandbox = await service.get("sbx_123");

    await expect(sandbox.connect()).rejects.toThrow("Sandbox sbx_123 is not running");
  });

  test("expose and unexpose preserve server fields and update cached exposed ports", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request");
    requestSpy
      .mockResolvedValueOnce(wireSandboxDetail())
      .mockResolvedValueOnce({
        port: 3000,
        auth: true,
        url: "https://3000-sbx_123.runtime.example.com/",
        browserUrl: "https://3000-sbx_123.runtime.example.com/_hb/auth?grant=token&next=%2F",
        browserUrlExpiresAt: "2026-03-12T13:00:00Z",
      })
      .mockResolvedValueOnce({
        port: 3000,
        exposed: false,
      });

    const sandbox = await service.create({ imageName: "node" });
    const exposed = await sandbox.expose({ port: 3000, auth: true });
    const unexposed = await sandbox.unexpose(3000);

    expect(exposed.browserUrl).toContain("/_hb/auth");
    expect(exposed.browserUrlExpiresAt).toBe("2026-03-12T13:00:00Z");
    expect(sandbox.exposedPorts).toEqual([]);
    expect(unexposed).toEqual({
      port: 3000,
      exposed: false,
    });
    expect(requestSpy).toHaveBeenNthCalledWith(2, "/sandbox/sbx_123/expose", {
      method: "POST",
      body: JSON.stringify({ port: 3000, auth: true }),
    });
    expect(requestSpy).toHaveBeenNthCalledWith(3, "/sandbox/sbx_123/unexpose", {
      method: "POST",
      body: JSON.stringify({ port: 3000 }),
    });
  });

  test("list normalizes sandbox sizing to cpu memoryMiB and diskMiB", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    vi.spyOn(service as any, "request").mockResolvedValue({
      sandboxes: [
        {
          id: "sbx_123",
          teamId: "team_1",
          status: "active",
          endTime: null,
          startTime: 123,
          createdAt: "2026-03-12T00:00:00Z",
          updatedAt: "2026-03-12T00:00:01Z",
          closeReason: null,
          dataConsumed: 1,
          proxyDataConsumed: 2,
          usageType: "sandbox",
          jobId: null,
          launchState: null,
          creditsUsed: 0.1,
          region: "us",
          sessionUrl: "https://example.com/session",
          duration: 10,
          proxyBytesUsed: 3,
          vcpus: 2,
          memMiB: 2048,
          diskSizeMiB: 8192,
          runtime: {
            transport: "regional_proxy",
            host: "https://runtime.example.com",
            baseUrl: "https://runtime.example.com/sandbox/sbx_123",
          },
          exposedPorts: [],
        },
      ],
      totalCount: 1,
      page: 1,
      perPage: 10,
    });

    const response = await service.list();

    expect(response.sandboxes[0]).toMatchObject({
      cpu: 2,
      memoryMiB: 2048,
      diskMiB: 8192,
    });
  });

  test("create rejects cpu memoryMiB and diskMiB for snapshot launches", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);

    await expect(
      service.create({
        snapshotName: "snap",
        cpu: 2,
      } as any)
    ).rejects.toThrow("cpu, memoryMiB, and diskMiB are only supported for image launches");
  });

  test("batch file writes forward encoding, append, and mode per entry", async () => {
    const requestJSON = vi.fn().mockResolvedValue({
      files: [{ path: "/tmp/hello.txt", name: "hello.txt", type: "file" }],
    });
    const files = new SandboxFilesApi({ requestJSON } as any, async () => ({
      sandboxId: "sbx_123",
      baseUrl: "https://runtime.example.com/sandbox/sbx_123",
      token: "runtime-token",
    }));

    await files.write([
      {
        path: "/tmp/hello.txt",
        data: "aGVsbG8=",
        encoding: "base64",
        append: true,
        mode: "600",
      },
    ]);

    expect(requestJSON).toHaveBeenCalledWith("/sandbox/files/write", {
      method: "POST",
      body: JSON.stringify({
        files: [
          {
            path: "/tmp/hello.txt",
            data: "aGVsbG8=",
            encoding: "base64",
            append: true,
            mode: "600",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
      },
    });
  });

  test("terminal attach forwards cursor to the websocket URL", async () => {
    const toWebSocketUrlSpy = vi
      .spyOn(wsModule, "toWebSocketUrl")
      .mockReturnValue({ url: "wss://runtime.example.com/ws" });
    vi.spyOn(wsModule, "openRuntimeWebSocket").mockResolvedValue({
      on: vi.fn(),
      once: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      readyState: 1,
    } as any);

    const terminal = new SandboxTerminalHandle(
      {} as any,
      async () => ({
        sandboxId: "sbx_123",
        baseUrl: "https://runtime.example.com/sandbox/sbx_123",
        token: "runtime-token",
      }),
      {
        id: "pty_123",
        command: "bash",
        cwd: "/",
        running: true,
        rows: 24,
        cols: 80,
        startedAt: Date.now(),
      }
    );

    await terminal.attach(10);

    expect(toWebSocketUrlSpy).toHaveBeenCalledWith(
      "https://runtime.example.com/sandbox/sbx_123",
      "/sandbox/pty/pty_123/ws?sessionId=sbx_123&cursor=10",
      undefined
    );
  });
});
