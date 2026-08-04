import { afterEach, describe, expect, test, vi } from "vitest";
import { SandboxesService } from "../../../src/services/sandboxes";

const parseJsonRequestBody = (init: unknown): Record<string, unknown> => {
  if (!init || typeof init !== "object" || !("body" in init) || typeof init.body !== "string") {
    throw new TypeError("Expected a string request body");
  }

  const body = JSON.parse(init.body) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("Expected a JSON object request body");
  }
  return body as Record<string, unknown>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sandbox image build request contract", () => {
  const inputSha256 = "a".repeat(64);

  test("omits format and platform so the server can apply its defaults", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue({});

    await service.createImageBuild({
      imageName: "node",
      inputSha256,
      inputSizeBytes: 1024,
    });
    await service.completeImageBuild("build_123", {
      inputSha256,
      inputSizeBytes: 1024,
    });

    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toEqual({
      imageName: "node",
      inputSha256,
      inputSizeBytes: 1024,
    });
    expect(parseJsonRequestBody(requestSpy.mock.calls[1][1])).toEqual({
      inputSha256,
      inputSizeBytes: 1024,
    });
  });

  test("forwards the exact supported format and platform when explicitly provided", async () => {
    const service = new SandboxesService("test-key", "https://api.example.com", 30_000);
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue({});

    await service.createImageBuild({
      imageName: "node",
      inputSha256,
      inputSizeBytes: 1024,
      inputFormat: "rootfs_export_tar_gz",
      sourcePlatform: "linux/amd64",
    });
    await service.completeImageBuild("build_123", {
      inputSha256,
      inputSizeBytes: 1024,
      inputFormat: "rootfs_export_tar_gz",
    });

    expect(parseJsonRequestBody(requestSpy.mock.calls[0][1])).toMatchObject({
      inputFormat: "rootfs_export_tar_gz",
      sourcePlatform: "linux/amd64",
    });
    expect(parseJsonRequestBody(requestSpy.mock.calls[1][1])).toMatchObject({
      inputFormat: "rootfs_export_tar_gz",
    });
  });
});
