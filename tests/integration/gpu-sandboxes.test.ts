import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SandboxesService } from "../../src/services/sandboxes";
import { HyperbrowserError } from "../../src/error";
import { ComputerAction } from "../../src/types/computer-action";
import { SandboxDetail, CreateSandboxParams, SandboxImageBuild } from "../../src/types/sandbox";
import { imageBuildName } from "../../src/sandbox/image-build/resolution";
import { localHTTP } from "../helpers/local-http";

const contract = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/gpu_contract.json"), "utf8")
);
const detail = (name: string): SandboxDetail => contract[name] as SandboxDetail;
const params: CreateSandboxParams = {
  imageName: "gpu-image",
  gpu: "H100",
  gpuCount: 2,
  preempt: false,
  region: "us",
  cpu: 8,
  memoryMiB: 32768,
  diskMiB: 524288,
  enableRecording: true,
  exposedPorts: [{ port: 8000, auth: true }],
  allowInternetAccess: true,
  allowOut: ["example.com"],
  denyOut: [],
};
const service = () => new SandboxesService("control-key", "https://control.test", 1_000);
const spyRequest = (sdk: SandboxesService) =>
  vi.spyOn(
    sdk as unknown as {
      request: (
        path: string,
        init?: { method?: string; body?: string; signal?: AbortSignal },
        params?: unknown
      ) => Promise<any>;
    },
    "request"
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GPU sandbox contract", () => {
  test("serializes launch options and retains provisioning metadata", async () => {
    const sdk = service();
    const spy = spyRequest(sdk).mockResolvedValue(detail("provisioning"));
    const sandbox = await sdk.create(params);
    expect(JSON.parse(spy.mock.calls[0][1]!.body!)).toEqual(contract.create);
    expect(sandbox.runtime).toBeNull();
    expect(sandbox.status).toBe("provisioning");
    expect(sandbox.gpuType).toBe("H100");
    expect(sandbox.gpuCount).toBe(2);
    expect(sandbox.preempt).toBe(false);
    expect(sandbox.recordingEnabled).toBe(true);
    expect(sandbox.capabilities).toMatchObject({
      writableStorage: "disk",
      liveNetworkUpdates: true,
    });
    await expect(sandbox.exec("nvidia-smi")).rejects.toMatchObject({ code: "sandbox_not_ready" });
    expect(() => sandbox.getExposedUrl(8000)).toThrow("not ready");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test.each([
    { gpu: undefined },
    { gpuCount: 0 },
    { gpuCount: 9 },
    { gpuCount: 1.5 },
    { gpuCount: true },
    { preempt: "false" },
    { gpu: "A100" },
    { runtimeClass: "firecracker" },
    { region: "us-east" },
    { diskMiB: 12287 },
    { diskMiB: 524289 },
    { imageName: undefined, snapshotName: "snapshot" },
    { mounts: { "/data": { id: "volume" } } },
    { secrets: { TOKEN: "token" } },
  ])("rejects invalid GPU options %j before sending", async (invalid) => {
    const sdk = service();
    const spy = spyRequest(sdk);
    await expect(sdk.create({ ...params, ...invalid } as CreateSandboxParams)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  test("keeps omitted defaults server-owned", async () => {
    const sdk = service();
    const spy = spyRequest(sdk).mockResolvedValue(detail("provisioning"));
    await sdk.create({ imageName: "gpu", gpu: "B300" });
    expect(JSON.parse(spy.mock.calls[0][1]!.body!)).toEqual({ imageName: "gpu", gpu: "B300" });
  });

  test("wait retries transient reads and hydrates runtime", async () => {
    const sdk = service();
    const spy = spyRequest(sdk)
      .mockRejectedValueOnce(
        new HyperbrowserError("temporary", { statusCode: 503, retryable: true })
      )
      .mockResolvedValueOnce(detail("active"));
    const sandbox = sdk.attach(detail("provisioning"));
    expect(await sandbox.waitUntilReady({ pollInterval: 0 })).toBe(sandbox);
    expect(sandbox.status).toBe("active");
    expect((await sandbox.createRuntimeSession()).token).toBe("runtime-token");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      spy.mock.calls.every(([p, init]) => p === "/sandbox/gpu-sandbox-1" && !init?.method)
    ).toBe(true);
  });

  test.each(["closed", "timeout", "cancelled", "forbidden", "wrong_id"])(
    "wait failure %s never stops or recreates",
    async (failure) => {
      const sdk = service();
      const spy = spyRequest(sdk);
      if (failure === "forbidden")
        spy.mockRejectedValue(new HyperbrowserError("forbidden", { statusCode: 403 }));
      else
        spy.mockResolvedValue(
          failure === "wrong_id" ? { ...detail("active"), id: "other" } : detail("closed")
        );
      const sandbox = sdk.attach(detail("provisioning"));
      const controller = new AbortController();
      if (failure === "cancelled") controller.abort();
      const result = sandbox.waitUntilReady({
        timeout: failure === "timeout" ? 0 : 1,
        pollInterval: 0,
        signal: controller.signal,
      });
      const codes: Record<string, string> = {
        closed: "sandbox_not_running",
        timeout: "wait_timeout",
        cancelled: "wait_cancelled",
      };
      if (codes[failure])
        await expect(result).rejects.toMatchObject({
          code: codes[failure],
          details: { sandboxId: sandbox.id },
        });
      else if (failure === "forbidden")
        await expect(result).rejects.toMatchObject({ statusCode: 403 });
      else await expect(result).rejects.toThrow("different ID");
      expect(spy).toHaveBeenCalledTimes(["timeout", "cancelled"].includes(failure) ? 0 : 1);
      if (failure === "closed") {
        expect(sandbox.closeReason).toBe("preempted");
        expect(sandbox.toJSON().creditsUsed).toBe(1.25);
      }
    }
  );

  test.each(["deadline", "abort"])("interrupts a pending read on %s", async (reason) => {
    const sdk = service();
    const spy = spyRequest(sdk).mockImplementation(
      (_p, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new HyperbrowserError("aborted")), {
            once: true,
          });
        })
    );
    const controller = new AbortController();
    const sandbox = sdk.attach(detail("provisioning"));
    const result = sandbox.waitUntilReady({
      timeout: reason === "deadline" ? 0.01 : 1,
      signal: controller.signal,
    });
    if (reason === "abort") controller.abort();
    await expect(result).rejects.toMatchObject({
      code: reason === "deadline" ? "wait_timeout" : "wait_cancelled",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("computer actions use runtime auth and refresh it on 401", async () => {
    const actions: Array<{ auth: string | undefined; body: unknown }> = [];
    const server = await localHTTP(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      expect(req.url).toBe("/sandbox/gpu-sandbox-1/computer-action");
      actions.push({
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      res.setHeader("Content-Type", "application/json");
      res.statusCode = actions.length === 1 ? 401 : 200;
      res.end(
        JSON.stringify(
          actions.length === 1 ? { error: "expired" } : { success: true, screenshot: "cG5n" }
        )
      );
    });
    try {
      const sdk = service();
      const active = {
        ...detail("active"),
        runtime: {
          transport: "regional_proxy" as const,
          host: server.url,
          baseUrl: `${server.url}/sandbox/gpu-sandbox-1`,
        },
      };
      spyRequest(sdk).mockResolvedValue({ ...active, token: "fresh-token" });
      const sandbox = sdk.attach(active);
      expect(await sandbox.computerAction({ action: ComputerAction.SCREENSHOT })).toMatchObject({
        screenshot: "cG5n",
      });
      await sandbox.computerAction({ action: ComputerAction.CLICK, x: 4, y: 5, numClicks: 2 });
      expect(actions[0]).toEqual({ auth: "Bearer runtime-token", body: { action: "screenshot" } });
      expect(actions[1]).toEqual({ auth: "Bearer fresh-token", body: { action: "screenshot" } });
      expect(actions[2].body).toMatchObject({ numClicks: 2 });
    } finally {
      await server.close();
    }
  });

  test("retains GPU network patches and authenticated port grants", async () => {
    const sdk = service();
    const spy = spyRequest(sdk);
    spy
      .mockResolvedValueOnce({
        network: { allowInternetAccess: true, allowOut: ["example.com"], denyOut: [] },
      })
      .mockResolvedValueOnce({
        port: 8000,
        auth: true,
        url: "https://8000.runtime.test/",
        browserUrl: "https://8000.runtime.test/auth",
      });
    const sandbox = sdk.attach(detail("active"));
    await sandbox.updateNetwork({ allowOut: ["example.com"], denyOut: [] });
    expect(JSON.parse(spy.mock.calls[0][1]!.body!)).toEqual({
      allowOut: ["example.com"],
      denyOut: [],
    });
    expect(sandbox.network?.allowOut).toEqual(["example.com"]);
    expect(await sandbox.expose({ port: 8000, auth: true })).toMatchObject({
      auth: true,
      browserUrl: "https://8000.runtime.test/auth",
    });
  });
});

describe("GPU images", () => {
  test("waits for GPU publication after build completion", async () => {
    const sdk = service();
    const spy = spyRequest(sdk)
      .mockResolvedValueOnce({ build: contract.building })
      .mockResolvedValueOnce({ build: contract.gpuReady });
    expect((await sdk.waitForImageBuild("gpu-build-1", { pollInterval: 0 })).gpuImageReady).toBe(
      true
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("surfaces publication failure without exposing internal errors", async () => {
    const sdk = service();
    spyRequest(sdk).mockResolvedValue({
      build: { ...contract.building, metadata: { ociPublicationError: "internal-error" } },
    });
    await expect(sdk.waitForImageBuild("gpu-build-1")).rejects.toMatchObject({
      code: "gpu_image_publication_failed",
    });
  });

  test("separates GPU identity and rejects unsupported inputs before Docker work", async () => {
    const identity = { source: "dockerfile" as const, fingerprint: "a".repeat(64) };
    expect(imageBuildName(identity)).not.toBe(
      imageBuildName({ ...identity, enableGPUBuilds: true })
    );
    expect(imageBuildName(identity)).toBe(imageBuildName({ ...identity, enableGPUBuilds: false }));
    const sdk = service();
    const spy = spyRequest(sdk);
    await expect(
      sdk.buildImageFromDockerImage({
        imageName: "gpu",
        dockerImage: "cuda",
        enableGPUBuilds: true,
      })
    ).rejects.toThrow("remote Dockerfile");
    await expect(
      sdk.buildImageFromDockerfile({
        imageName: "gpu",
        contextPath: "/missing",
        remote: false,
        enableGPUBuilds: true,
      })
    ).rejects.toThrow("remote: true");
    await expect(
      sdk.createImageBuild({
        imageName: "gpu",
        inputSha256: "a".repeat(64),
        inputSizeBytes: 1,
        inputFormat: "docker_image_manifest_v1",
        enableGPUBuilds: true,
      })
    ).rejects.toThrow("remote Dockerfile");
    expect(spy).not.toHaveBeenCalled();
  });

  test.each(["created", "joined", "reused", "cpu_only", "detached"])(
    "resolves GPU builds: %s",
    async (mode) => {
      const context = mkdtempSync(path.join(tmpdir(), "hb-gpu-"));
      writeFileSync(path.join(context, "Dockerfile"), "FROM scratch\n");
      try {
        const { dockerBuildContextFingerprint } = await import(
          "../../src/sandbox/image-build/context"
        );
        const name = imageBuildName({
          source: "dockerfile",
          fingerprint: await dockerBuildContextFingerprint(context),
          enableGPUBuilds: true,
        });
        const build = (ready = false): SandboxImageBuild => ({
          ...(ready ? contract.gpuReady : contract.building),
          imageName: name,
        });
        const sdk = service();
        let polls = 0;
        const spy = spyRequest(sdk).mockImplementation(async (url, init) => {
          if (url === "/images/builds" && !init?.method) {
            const rows = ["reused", "cpu_only"].includes(mode) ? [build(mode === "reused")] : [];
            if (mode === "cpu_only") rows[0].enableGPUBuilds = false;
            return { builds: rows };
          }
          if (url === "/images")
            return { images: [{ id: "gpu-image-1", imageName: name, uploaded: true }] };
          if (url === "/images/builds") {
            expect(JSON.parse(init!.body!).enableGPUBuilds).toBe(true);
            if (mode === "joined")
              throw new HyperbrowserError("in progress", {
                statusCode: 409,
                code: "image_build_in_progress",
                details: { build: build() },
              });
            return { build: build(), uploads: [] };
          }
          if (url.endsWith("/complete")) return { build: build() };
          expect(url).toBe("/images/builds/gpu-build-1");
          polls += 1;
          return { build: build(polls > 1) };
        });
        const result = await sdk.getOrBuildImage({
          contextPath: context,
          enableGPUBuilds: true,
          pollInterval: 0,
          wait: mode !== "detached",
        });
        expect(result.outcome).toBe(
          ({ joined: "joined", reused: "reused" } as Record<string, string>)[mode] ?? "created"
        );
        expect(result.imageId).toBe(mode === "detached" ? undefined : "gpu-image-1");
        expect(polls).toBe(["reused", "detached"].includes(mode) ? 0 : 2);
        expect(spy.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
      } finally {
        rmSync(context, { recursive: true, force: true });
      }
    }
  );
});
