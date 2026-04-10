import { describe, expect, test, vi } from "vitest";
import { VolumesService } from "../../../src/services/volumes";

describe("volume control contract", () => {
  test("create forwards payload and returns created volume", async () => {
    const service = new VolumesService("test-key", "https://api.example.com", 30_000);
    const payload = {
      id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
      name: "project-cache",
      size: 0,
      transferAmount: 0,
    };

    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.create({
      name: "project-cache",
    });

    expect(requestSpy).toHaveBeenCalledWith("/volume", {
      method: "POST",
      body: JSON.stringify({
        name: "project-cache",
      }),
    });
    expect(response).toEqual(payload);
  });

  test("list returns wrapped volumes response", async () => {
    const service = new VolumesService("test-key", "https://api.example.com", 30_000);
    const payload = {
      volumes: [
        {
          id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
          name: "project-cache",
          size: 0,
          transferAmount: 0,
        },
      ],
    };

    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.list();

    expect(requestSpy).toHaveBeenCalledWith("/volume");
    expect(response).toEqual(payload);
  });

  test("get returns a single volume payload", async () => {
    const service = new VolumesService("test-key", "https://api.example.com", 30_000);
    const payload = {
      id: "2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d",
      name: "project-cache",
    };

    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.get("2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d");

    expect(requestSpy).toHaveBeenCalledWith("/volume/2d6f01cf-c5d7-4c61-ae9e-0264f1c8063d");
    expect(response).toEqual(payload);
  });
});
