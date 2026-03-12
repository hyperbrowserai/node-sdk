import { describe, expect, test, vi } from "vitest";
import { SandboxesService } from "../../../src/services/sandboxes";

describe("sandbox control list contract", () => {
  test("list forwards status, page, and limit to the control API", async () => {
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
            host: "runtime.example.com",
            baseUrl: "https://runtime.example.com",
          },
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
      page: 2,
      limit: 5,
    });

    expect(requestSpy).toHaveBeenCalledWith("/sandboxes", undefined, {
      status: "active",
      page: 2,
      limit: 5,
    });
    expect(response).toEqual(payload);
  });
});
