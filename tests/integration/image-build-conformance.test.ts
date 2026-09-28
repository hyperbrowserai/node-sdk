import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, expect, test, vi } from "vitest";
import { SandboxesService } from "../../src/services/sandboxes";
import { HyperbrowserError } from "../../src/error";
import {
  uploadImageBuildArtifact,
  uploadMissingImageBuildArtifacts,
} from "../../src/sandbox/image-build/upload";
import { localHTTP, delay } from "../helpers/local-http";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "hb-conformance-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "Dockerfile"), "FROM scratch\nCOPY data /data\n");
  writeFileSync(path.join(dir, "data"), "payload");
  return dir;
}
function upload(url: string, method = "PUT") {
  return {
    url,
    method,
    headers: { "x-test": "header" },
    maxUploadBytes: 100,
    objectKey: "key",
    expiresInSeconds: 60,
  };
}

test.each([408, 429, 500, 503, 403])(
  "artifact upload retry contract for HTTP %s",
  async (status) => {
    const received: string[] = [];
    const server = await localHTTP(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      expect(req.headers["content-length"]).toBe("7");
      expect(req.headers["x-test"]).toBe("header");
      received.push(Buffer.concat(chunks).toString());
      res.writeHead(received.length === 1 ? status : 200);
      res.end("reply");
    });
    cleanup.push(server.close);
    const pending = uploadImageBuildArtifact(upload(server.url), path.join(workspace(), "data"), {
      timeout: 1,
    });
    if (status === 403) await expect(pending).rejects.toThrow("403");
    else await pending;
    expect(received).toEqual(Array(status === 403 ? 1 : 2).fill("payload"));
  }
);
test("non-idempotent artifact upload never replays and size limits fail before HTTP", async () => {
  let calls = 0;
  const server = await localHTTP((req, res) => {
    calls++;
    req.resume();
    res.writeHead(503);
    res.end("busy");
  });
  cleanup.push(server.close);
  const file = path.join(workspace(), "data");
  await expect(uploadImageBuildArtifact(upload(server.url, "POST"), file)).rejects.toThrow("503");
  await expect(
    uploadImageBuildArtifact({ ...upload(server.url), maxUploadBytes: 1 }, file)
  ).rejects.toThrow("limit");
  expect(calls).toBe(1);
});
test("upload response inactivity times out, closes sockets, and bounds PUT retries", async () => {
  let calls = 0;
  const server = await localHTTP((req, res) => {
    calls++;
    req.resume();
    res.writeHead(200);
    res.write("partial");
  });
  cleanup.push(server.close);
  await expect(
    uploadImageBuildArtifact(upload(server.url), path.join(workspace(), "data"), { timeout: 0.02 })
  ).rejects.toThrow("inactivity");
  await delay(15);
  expect(calls).toBe(3);
  expect(server.sockets.size).toBe(0);
});
test.each(["unknown", "duplicate", "method", "size"])(
  "invalid selective upload %s fails before any request",
  async (kind) => {
    const file = path.join(workspace(), "data");
    const digest = "a".repeat(64);
    const artifact = {
      path: file,
      sha256Hex: digest,
      sizeBytes: 7,
      inputFormat: "docker_image_manifest_v1" as const,
      sourcePlatform: "linux/amd64" as const,
      imageConfigUser: "",
    };
    const entry = { ...upload("http://unused.invalid"), sha256: digest };
    const requests =
      kind === "duplicate"
        ? [entry, entry]
        : [
            {
              ...entry,
              ...(kind === "unknown" ? { sha256: "b".repeat(64) } : {}),
              ...(kind === "method" ? { method: "POST" } : {}),
              ...(kind === "size" ? { maxUploadBytes: 1 } : {}),
            },
          ];
    await expect(
      uploadMissingImageBuildArtifacts(requests, { [digest]: artifact }, { label: "layer" })
    ).rejects.toThrow(/unknown|duplicate|unsupported|limit/);
  }
);
test("ready lookup searches later pages and requires an exact match", async () => {
  const service = new SandboxesService("local", "http://unused", 1000);
  const list = vi
    .spyOn(service, "listImages")
    .mockResolvedValueOnce({
      images: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        imageName: `other${i}`,
        namespace: "ns",
        uploaded: true,
        createdAt: "",
        updatedAt: "",
      })),
      totalCount: 101,
    })
    .mockResolvedValueOnce({
      images: [
        {
          id: "correct",
          imageName: "target",
          namespace: "ns",
          uploaded: false,
          ready: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      totalCount: 101,
    });
  expect((await service.findReadyImage("target"))?.id).toBe("correct");
  expect(list.mock.calls.map(([params]) => params?.page)).toEqual([1, 2]);
});
test.each([
  {},
  { contextPath: ".", dockerImage: "image" },
  { contextPath: ".", expectedImageDigest: "sha256:" + "a".repeat(64) },
  { dockerImage: "image", expectedContextFingerprint: "a".repeat(64) },
  { dockerImage: "image", remoteFullContext: true },
])("invalid resolution options fail before HTTP or Docker: %j", async (options) => {
  const service = new SandboxesService("local", "http://unused", 1000);
  const find = vi.spyOn(service, "findReadyImage");
  await expect(service.getOrBuildImage(options)).rejects.toThrow();
  expect(find).not.toHaveBeenCalled();
});
test("public build fingerprint rejection precedes API calls and local Docker builds", async () => {
  const service = new SandboxesService("local", "http://unused", 1000);
  const create = vi.spyOn(service, "createImageBuild");
  const contextPath = workspace();
  await expect(
    service.buildImageFromDockerfile({
      contextPath,
      imageName: "n",
      expectedContextFingerprint: "a".repeat(64),
    })
  ).rejects.toThrow(/changed/i);
  await expect(
    service.buildImageFromDockerfile({
      contextPath,
      imageName: "n",
      remote: false,
      expectedContextFingerprint: "a".repeat(64),
    })
  ).rejects.toThrow(/remote/);
  expect(create).not.toHaveBeenCalled();
});
test.each(["upload verification", "already in progress"])(
  "completion race recovers: %s",
  async (message) => {
    const service = new SandboxesService("local", "http://unused", 1000);
    const build = { id: "b", imageName: "n", status: "building" as const };
    vi.spyOn(service, "createImageBuild").mockResolvedValue({ build, uploads: [] });
    const complete = vi
      .spyOn(service, "completeImageBuild")
      .mockRejectedValueOnce(new HyperbrowserError(message, { statusCode: 409 }))
      .mockResolvedValue(build);
    vi.spyOn(service, "getImageBuild").mockResolvedValue(
      message === "already in progress" ? build : { ...build, status: "awaiting_upload" }
    );
    const cancel = vi.spyOn(service, "cancelImageBuild");
    const dir = workspace();
    expect(
      (
        await service.buildImageFromDockerfile({
          contextPath: dir,
          imageName: "n",
          wait: false,
          tempDir: dir,
        })
      ).id
    ).toBe("b");
    expect(complete).toHaveBeenCalledTimes(message === "already in progress" ? 1 : 2);
    expect(cancel).not.toHaveBeenCalled();
    expect(readdirSync(dir).sort()).toEqual(["Dockerfile", "data"]);
  }
);
test("submission failures cancel once and clean artifacts even when cancellation fails", async () => {
  const service = new SandboxesService("local", "http://unused", 1000);
  vi.spyOn(service, "createImageBuild").mockResolvedValue({
    build: { id: "b", imageName: "n", status: "awaiting_upload" },
    uploads: [{ ...upload("http://unused"), sha256: "bad" }],
  });
  const cancel = vi
    .spyOn(service, "cancelImageBuild")
    .mockRejectedValue(new Error("cleanup failed"));
  const dir = workspace();
  await expect(
    service.buildImageFromDockerfile({ contextPath: dir, imageName: "n", tempDir: dir })
  ).rejects.toThrow("unknown");
  expect(cancel).toHaveBeenCalledExactlyOnceWith("b");
  expect(readdirSync(dir).sort()).toEqual(["Dockerfile", "data"]);
});

test.each(["cancel-one", "timeout-one", "cancel-both"])(
  "concurrent resolution callers remain independent: %s",
  async (leave) => {
    const contextPath = workspace();
    const methods: string[] = [];
    let name = "";
    let created = false;
    let release = false;
    let firstPoll!: () => void;
    let secondPoll!: () => void;
    const firstPolling = new Promise<void>((resolve) => {
      firstPoll = resolve;
    });
    const secondPolling = new Promise<void>((resolve) => {
      secondPoll = resolve;
    });
    let polls = 0;
    const build = (status = "building") => ({
      id: "b",
      imageName: name,
      status,
      imageId: "image",
      metadata: { inputFormat: "dockerfile_context_manifest_v1", sourcePlatform: "linux/amd64" },
    });
    const server = await localHTTP(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(Buffer.from(chunk));
      const pathname = new URL(req.url!, "http://local").pathname;
      methods.push(`${req.method} ${pathname}`);
      if (pathname === "/api/images") {
        res.end('{"images":[]}');
        return;
      }
      if (pathname === "/api/images/builds") {
        name = JSON.parse(Buffer.concat(parts).toString()).imageName;
        if (created) {
          res.writeHead(409);
          res.end(
            JSON.stringify({ code: "image_build_in_progress", message: "building", build: build() })
          );
        } else {
          created = true;
          res.end(JSON.stringify({ build: build("awaiting_upload"), uploads: [] }));
        }
        return;
      }
      if (pathname.endsWith("/complete")) {
        res.end(JSON.stringify({ build: build() }));
        return;
      }
      polls++;
      firstPoll();
      if (polls >= 2) secondPoll();
      while (!release && !res.destroyed) await delay(5);
      if (!res.destroyed) res.end(JSON.stringify({ build: build("completed") }));
    });
    cleanup.push(server.close);
    const service = new SandboxesService("local", server.url, 2000);
    const a = new AbortController();
    const b = new AbortController();
    const first = service
      .getOrBuildImage({
        contextPath,
        waitTimeout: leave === "timeout-one" ? 0.1 : 5,
        signal: a.signal,
      })
      .catch((error) => error);
    await firstPolling;
    const second = service
      .getOrBuildImage({ contextPath, waitTimeout: 5, signal: b.signal })
      .catch((error) => error);
    try {
      await secondPolling;
      if (leave !== "timeout-one") a.abort();
      expect((await first).code).toBe(leave === "timeout-one" ? "wait_timeout" : "request_aborted");
      if (leave === "cancel-both") {
        b.abort();
        expect((await second).code).toBe("request_aborted");
      } else {
        release = true;
        expect(await second).toMatchObject({ outcome: "joined", imageId: "image" });
      }
      expect(methods.filter((entry) => entry.endsWith("/complete"))).toHaveLength(1);
      expect(methods.some((entry) => entry.endsWith("/cancel"))).toBe(false);
    } finally {
      release = true;
      a.abort();
      b.abort();
      await Promise.allSettled([first, second]);
    }
  }
);

test.each(["list", "listImages", "listSnapshots"] as const)(
  "pagination validates bounds before HTTP: %s",
  async (method) => {
    const sdk = new SandboxesService("local", "http://unused", 1000);
    for (const params of [{ page: 0 }, { page: 1.5 }, { limit: -1 }, { limit: NaN }])
      await expect(sdk[method](params)).rejects.toThrow(/positive integer/);
    if (method !== "list") await expect(sdk[method]({ limit: 101 })).rejects.toThrow("at most 100");
  }
);
test.each(["linux/arm64", "LINUX/AMD64", " linux/amd64 "])(
  "raw image build platform literals reject %s",
  async (sourcePlatform) => {
    const sdk = new SandboxesService("local", "http://unused", 1000);
    await expect(
      sdk.createImageBuild({
        imageName: "n",
        inputSha256: "a",
        inputSizeBytes: 1,
        sourcePlatform,
      } as never)
    ).rejects.toThrow("sourcePlatform");
    await expect(
      sdk.reuseDockerImage({ imageName: "n", sourceImageDigest: "a", sourcePlatform } as never)
    ).rejects.toThrow("sourcePlatform");
  }
);
test("raw image build formats are validated before submission or completion", async () => {
  const sdk = new SandboxesService("local", "http://unused", 1000);
  const params = {
    imageName: "n",
    inputSha256: "a",
    inputSizeBytes: 1,
    inputFormat: "ROOTFS_EXPORT_TAR_GZ",
  } as never;
  await expect(sdk.createImageBuild(params)).rejects.toThrow("inputFormat");
  await expect(sdk.completeImageBuild("b", params)).rejects.toThrow("inputFormat");
});
