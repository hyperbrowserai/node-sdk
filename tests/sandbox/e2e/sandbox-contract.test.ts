import { describe, expect, test, vi, afterEach } from "vitest";
import { SandboxFilesApi } from "../../../src/sandbox/files";
import { SandboxTerminalHandle } from "../../../src/sandbox/terminal";
import * as wsModule from "../../../src/sandbox/ws";
import { SandboxesService } from "../../../src/services/sandboxes";
import type { SandboxDetail } from "../../../src/types";

const sandboxDetail = (overrides: Partial<SandboxDetail> = {}): SandboxDetail => ({
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
  runtime: {
    transport: "regional_proxy",
    host: "runtime.example.com",
    baseUrl: "https://runtime.example.com",
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
  test("create forwards exposedPorts and hydrates handle exposed ports", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const payload = sandboxDetail({
      exposedPorts: [
        {
          port: 3000,
          auth: true,
          url: "https://3000-runtime.example.com/",
          browserUrl: "https://3000-runtime.example.com/_hb/auth?grant=token&next=%2F",
          browserUrlExpiresAt: "2026-03-12T13:00:00Z",
        },
      ],
    });
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const sandbox = await service.create({
      imageName: "node",
      exposedPorts: [{ port: 3000, auth: true }],
    });

    expect(requestSpy).toHaveBeenCalledWith("/sandbox", {
      method: "POST",
      body: JSON.stringify({
        imageName: "node",
        exposedPorts: [{ port: 3000, auth: true }],
      }),
    });
    expect(sandbox.exposedPorts).toEqual(payload.exposedPorts);
    expect(sandbox.getExposedUrl(3000)).toBe("https://3000-runtime.example.com/");
  });

  test("expose and unexpose preserve server fields and update cached exposed ports", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request");
    requestSpy
      .mockResolvedValueOnce(sandboxDetail())
      .mockResolvedValueOnce({
        port: 3000,
        auth: true,
        url: "https://3000-runtime.example.com/",
        browserUrl: "https://3000-runtime.example.com/_hb/auth?grant=token&next=%2F",
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

  test("batch file writes forward encoding, append, and mode per entry", async () => {
    const requestJSON = vi.fn().mockResolvedValue({
      files: [{ path: "/tmp/hello.txt", name: "hello.txt", type: "file" }],
    });
    const files = new SandboxFilesApi(
      { requestJSON } as any,
      async () => ({
        sandboxId: "sbx_123",
        baseUrl: "https://runtime.example.com",
        token: "runtime-token",
      })
    );

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
        baseUrl: "https://runtime.example.com",
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
      "https://runtime.example.com",
      "/sandbox/pty/pty_123/ws?sessionId=sbx_123&cursor=10",
      undefined
    );
  });
});
