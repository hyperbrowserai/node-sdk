import { describe, expect, test, vi } from "vitest";
import { SandboxesService } from "../../../src/services/sandboxes";

describe("sandbox control list contract", () => {
  test("list forwards status, start, end, search, page, and limit to the control API", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const payload = {
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
          runtime: {
            transport: "regional_proxy" as const,
            host: "https://runtime.example.com",
            baseUrl: "https://runtime.example.com/sandbox/sbx_123",
          },
          exposedPorts: [
            {
              port: 3000,
              auth: true,
              url: "https://3000-sbx_123.runtime.example.com/",
              browserUrl: "https://3000-sbx_123.runtime.example.com/_hb/auth?grant=token&next=%2F",
              browserUrlExpiresAt: "2026-03-12T00:00:01Z",
            },
          ],
        },
      ],
      totalCount: 1,
      page: 2,
      perPage: 5,
    };

    const requestSpy = vi
      .spyOn(service as any, "request")
      .mockResolvedValue(payload);

    const response = await service.list({
      status: "active",
      start: 1,
      end: 2,
      search: "sbx_123",
      page: 2,
      limit: 5,
    });

    expect(requestSpy).toHaveBeenCalledWith("/sandboxes", undefined, {
      status: "active",
      start: 1,
      end: 2,
      search: "sbx_123",
      page: 2,
      limit: 5,
    });
    expect(response).toEqual(payload);
  });

  test("listImages returns the wrapped image response from the control API", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const payload = {
      images: [
        {
          id: "img_123",
          imageName: "node",
          namespace: "team_1",
          uploaded: true,
          createdAt: "2026-03-12T00:00:00Z",
          updatedAt: "2026-03-12T00:00:01Z",
        },
      ],
    };

    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.listImages();

    expect(requestSpy).toHaveBeenCalledWith("/images");
    expect(response).toEqual(payload);
  });

  test("listSnapshots returns the wrapped snapshot response from the control API", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const payload = {
      snapshots: [
        {
          id: "snap_123",
          snapshotName: "snapshot-1",
          namespace: "team_1",
          imageNamespace: "team_1",
          imageName: "node",
          imageId: "img_123",
          status: "created" as const,
          compatibilityTag: "v1",
          metadata: {},
          uploaded: true,
          createdAt: "2026-03-12T00:00:00Z",
          updatedAt: "2026-03-12T00:00:01Z",
        },
      ],
    };

    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.listSnapshots({
      status: "created",
      imageName: "node",
      limit: 10,
    });

    expect(requestSpy).toHaveBeenCalledWith("/snapshots", undefined, {
      status: "created",
      imageName: "node",
      limit: 10,
    });
    expect(response).toEqual(payload);
  });
});
