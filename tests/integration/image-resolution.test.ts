import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RequestInit } from "node-fetch";
import { HyperbrowserError } from "../../src/client";
import { DockerBuildContextChangedError } from "../../src/sandbox/image-build/context";
import { SandboxesService } from "../../src/services/sandboxes";

type Request = { method: string; path: string; body?: Record<string, unknown>; params?: Record<string, unknown> };

class Backend {
  name: string | null = null;
  requests: Request[] = [];
  polls = 0;
  transform: (payload: Record<string, unknown>) => Record<string, unknown> = (v) => v;
  onListImages: (() => void) | null = null;
  imageRow: Record<string, unknown> = { uploaded: false, ready: true };

  constructor(private readonly options: { ready?: boolean; conflict?: boolean } = {}) {}

  build(status = "building"): Record<string, unknown> {
    return {
      id: "build-1",
      imageName: this.name,
      imageId: "image-1",
      status,
      metadata: { inputFormat: "dockerfile_context_manifest_v1", sourcePlatform: "linux/amd64" },
    };
  }

  respond(request: Request): unknown {
    this.requests.push(request);
    if (request.method === "GET" && request.path === "/images") {
      this.name = String(request.params?.search);
      this.onListImages?.();
      const image = {
        id: "image-1",
        imageName: this.name,
        namespace: "team-local",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...this.imageRow,
      };
      return { images: this.options.ready ? [image] : [] };
    }
    if (request.method === "POST" && request.path === "/images/builds") {
      this.name = String(request.body?.imageName);
      if (this.options.conflict) {
        const payload = this.transform({
          message: "already building",
          code: "image_build_in_progress",
          build: this.build(),
        });
        throw new HyperbrowserError(String(payload.message), {
          statusCode: 409,
          code: payload.code as string,
          details: payload,
          service: "control",
        });
      }
      return { build: this.build("awaiting_upload"), uploads: [] };
    }
    if (request.method === "POST" && request.path.endsWith("/complete")) {
      return { build: this.build() };
    }
    if (request.method === "GET" && request.path === "/images/builds/build-1") {
      this.polls += 1;
      return { build: this.build("completed") };
    }
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  }
}

const serviceFor = (backend: Backend): SandboxesService => {
  const service = new SandboxesService("local-only", "http://local.test", 30_000);
  vi.spyOn(service as unknown as { request: (...args: unknown[]) => Promise<unknown> }, "request").mockImplementation(
    async (...args: unknown[]) => {
      const [rawPath, init, params] = args as [string, RequestInit | undefined, Record<string, unknown> | undefined];
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      return backend.respond({ method: init?.method ?? "GET", path: rawPath, body, params });
    }
  );
  return service;
};

let context: string;
beforeEach(() => {
  context = mkdtempSync(path.join(tmpdir(), "hb-resolution-"));
  writeFileSync(path.join(context, "Dockerfile"), "FROM scratch\nCOPY data /data\n");
  writeFileSync(path.join(context, "data"), "first");
});
afterEach(() => {
  rmSync(context, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("getOrBuildImage resolution", () => {
  test.each(["ready", "created", "joined", "forced", "detached"])(
    "resolves ready, new and concurrent builds: %s",
    async (mode) => {
      const backend = new Backend({ ready: mode === "ready" || mode === "forced", conflict: mode === "joined" });
      const result = await serviceFor(backend).getOrBuildImage({
        contextPath: context,
        forceBuild: mode === "forced",
        wait: mode !== "detached",
        pollInterval: 0,
      });
      expect(result.outcome).toBe({ ready: "reused", joined: "joined" }[mode] ?? "created");
      expect(result.imageName.startsWith("hb__dockerfile__")).toBe(true);
      expect(result.imageId).toBe(mode === "detached" ? undefined : "image-1");
      expect(backend.polls).toBe(mode === "ready" || mode === "detached" ? 0 : 1);
      if (mode === "ready") {
        expect(backend.requests.map((r) => [r.method, r.path])).toEqual([["GET", "/images"]]);
      }
      if (mode === "forced") {
        expect(backend.requests.some((r) => r.path === "/images")).toBe(false);
      }
      expect(backend.requests.some((r) => r.path.endsWith("/cancel"))).toBe(false);
    }
  );

  test.each(["name", "format", "platform", "missing-status", "missing-build", "code"])(
    "incompatible conflicts are not joined: %s",
    async (mismatch) => {
      const backend = new Backend({ conflict: true });
      backend.transform = (payload) => {
        const build = payload.build as Record<string, unknown>;
        const metadata = build.metadata as Record<string, unknown>;
        if (mismatch === "name") build.imageName = "unrelated";
        else if (mismatch === "format") metadata.inputFormat = "docker_image_manifest_v1";
        else if (mismatch === "platform") metadata.sourcePlatform = "linux/arm64";
        else if (mismatch === "missing-status") delete build.status;
        else if (mismatch === "missing-build") delete payload.build;
        else payload.code = "different_conflict";
        return payload;
      };
      await expect(
        serviceFor(backend).getOrBuildImage({ contextPath: context, pollInterval: 0 })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(backend.polls).toBe(0);
    }
  );

  test("context change during lookup fails before submission", async () => {
    const backend = new Backend();
    backend.onListImages = () => writeFileSync(path.join(context, "data"), "changed");
    await expect(
      serviceFor(backend).getOrBuildImage({ contextPath: context, pollInterval: 0 })
    ).rejects.toBeInstanceOf(DockerBuildContextChangedError);
    expect(backend.requests.map((r) => [r.method, r.path])).toEqual([["GET", "/images"]]);
  });

  test.each([
    [true, undefined, true],
    [false, true, true],
    [false, false, false],
    [false, undefined, false],
  ])("ready lookup supports old servers (uploaded=%s ready=%s) -> reused=%s", async (uploaded, ready, reused) => {
    const backend = new Backend({ ready: true });
    backend.imageRow = { uploaded, ...(ready === undefined ? {} : { ready }) };
    const result = await serviceFor(backend).getOrBuildImage({ contextPath: context, pollInterval: 0 });
    expect(result.outcome).toBe(reused ? "reused" : "created");
  });

  test("requires exactly one of contextPath or dockerImage", async () => {
    const service = serviceFor(new Backend());
    await expect(service.getOrBuildImage({})).rejects.toThrow();
    await expect(
      service.getOrBuildImage({ contextPath: context, dockerImage: "node:20" })
    ).rejects.toThrow();
  });

  test("builder resources are serialized to the API wire names", async () => {
    const backend = new Backend();
    await serviceFor(backend).getOrBuildImage({
      contextPath: context,
      pollInterval: 0,
      builderCpus: 4,
      builderMemoryMiB: 8192,
      builderScratchMiB: 20480,
    });
    const create = backend.requests.find((r) => r.method === "POST" && r.path === "/images/builds");
    expect(create?.body).toMatchObject({
      vcpus: 4,
      memMiB: 8192,
      scratchMiB: 20480,
      inputFormat: "dockerfile_context_manifest_v1",
      sourcePlatform: "linux/amd64",
      dockerfilePath: "Dockerfile",
    });
    expect(create?.body).not.toHaveProperty("builderCpus");
    expect(create?.body?.contextManifest).toBeTruthy();
  });

  test("waitForImageBuild surfaces failures and timeouts", async () => {
    const service = new SandboxesService("local-only", "http://local.test", 30_000);
    const statuses = ["building", "failed"];
    vi.spyOn(service, "getImageBuild").mockImplementation(async () => ({
      id: "build-1",
      imageName: "x",
      status: statuses.shift() as "building",
      errorCode: "build_failed",
      errorMessage: "boom",
    }));
    await expect(service.waitForImageBuild("build-1", { pollInterval: 0 })).rejects.toThrow(/boom/);

    vi.spyOn(service, "getImageBuild").mockResolvedValue({ id: "build-1", imageName: "x", status: "building" });
    await expect(
      service.waitForImageBuild("build-1", { pollInterval: 0.001, timeout: 0.01 })
    ).rejects.toThrow(/timed out|Timed out/i);
  });

  test("dockerfile builds reject missing context directories", async () => {
    const missing = path.join(context, "missing");
    mkdirSync(path.join(context, "other"));
    await expect(
      serviceFor(new Backend()).getOrBuildImage({ contextPath: missing, pollInterval: 0 })
    ).rejects.toThrow();
  });
});
