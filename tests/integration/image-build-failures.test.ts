import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { writeGzipTar } from "../../src/sandbox/image-build/gzip";
import { uploadMissingImageBuildArtifacts } from "../../src/sandbox/image-build/upload";
import { DockerImageBuildArtifact } from "../../src/sandbox/image-build/artifacts";
import { SandboxesService } from "../../src/services/sandboxes";
import { localHTTP, delay } from "../helpers/local-http";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "hb-failure-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
describe("image build failure lifetimes", () => {
  test("packaging source errors are catchable without an unhandled compressor rejection", async () => {
    await expect(
      writeGzipTar(path.join(workspace(), "bundle.tgz"), async (writer) => {
        await writer.addEntry(
          { name: "removed", type: "file", mode: 0o644, size: 3, linkname: "" },
          (async function* () {
            yield Buffer.from("a");
            throw new Error("source disappeared");
          })()
        );
      })
    ).rejects.toThrow("source disappeared");
    await delay(15); // Vitest also rejects any background unhandled rejection.
  });
  test("destination write errors do not escape as uncaught stream errors", async () => {
    const file = path.join(workspace(), "exists");
    writeFileSync(file, "keep");
    await expect(writeGzipTar(file, async () => undefined)).rejects.toThrow();
    await delay(15);
    expect(existsSync(file)).toBe(true);
  });
  test("failed uploads settle active workers and stop scheduling before cleanup", async () => {
    const requested: string[] = [];
    let pending = 0;
    const server = await localHTTP((req, res) => {
      requested.push(req.url!);
      pending++;
      res.once("close", () => pending--);
      req.resume();
      req.on("end", () => {
        if (req.url === "/0") {
          res.writeHead(400);
          res.end("rejected");
        } else setTimeout(() => res.end("ok"), 35);
      });
    });
    cleanup.push(server.close);
    const dir = workspace();
    const artifacts: Record<string, DockerImageBuildArtifact> = {};
    const uploads = Array.from({ length: 8 }, (_, i) => {
      const sha256 = String(i).repeat(64);
      const file = path.join(dir, String(i));
      writeFileSync(file, "data");
      artifacts[sha256] = {
        path: file,
        sha256Hex: sha256,
        sizeBytes: 4,
        inputFormat: "docker_image_manifest_v1",
        sourcePlatform: "linux/amd64",
        imageConfigUser: "",
      };
      return {
        sha256,
        url: `${server.url}/${i}`,
        headers: {},
        method: "PUT",
        maxUploadBytes: 100,
        objectKey: String(i),
        expiresInSeconds: 60,
      };
    });
    await expect(
      uploadMissingImageBuildArtifacts(uploads, artifacts, { label: "layer", timeout: 1 })
    ).rejects.toThrow("rejected");
    rmSync(dir, { recursive: true, force: true });
    await delay(20);
    expect(pending).toBe(0);
    expect(requested.length).toBe(4);
  });
  test("resolution defaults uploads to 600 seconds and preserves explicit null", async () => {
    const service = new SandboxesService("local", "http://unused", 1000);
    vi.spyOn(service, "findReadyImage").mockResolvedValue(null);
    const build = vi
      .spyOn(service, "buildImageFromDockerfile")
      .mockResolvedValue({ id: "b", imageName: "n", status: "building" });
    const input = {
      contextPath: "/unused",
      expectedContextFingerprint: "a".repeat(64),
      wait: false,
    };
    await service.getOrBuildImage(input);
    expect(build.mock.calls[0][0].uploadTimeout).toBe(600);
    await service.getOrBuildImage({ ...input, uploadTimeout: null });
    expect(build.mock.calls[1][0].uploadTimeout).toBeNull();
  });
  test("build wait deadline includes control retries without canceling the backend build", async () => {
    const methods: string[] = [];
    const server = await localHTTP((req, res) => {
      methods.push(req.method!);
      res.writeHead(503);
      res.end('{"message":"retry"}');
    });
    cleanup.push(server.close);
    const service = new SandboxesService("local", server.url, 1000);
    const start = Date.now();
    await expect(service.waitForImageBuild("build", { timeout: 0.03 })).rejects.toMatchObject({
      code: "wait_timeout",
    });
    expect(Date.now() - start).toBeLessThan(300);
    expect(methods).toEqual(["GET"]);
  });
  test("independent waiters can be canceled without canceling another waiter", async () => {
    const server = await localHTTP((_req, res) => {
      res.end('{"build":{"id":"b","imageName":"n","status":"building"}}');
    });
    cleanup.push(server.close);
    const service = new SandboxesService("local", server.url, 1000);
    const controller = new AbortController();
    const first = service
      .waitForImageBuild("b", { signal: controller.signal, pollInterval: 0.01 })
      .catch((error) => error);
    const second = service
      .waitForImageBuild("b", { timeout: 0.05, pollInterval: 0.01 })
      .catch((error) => error);
    controller.abort();
    expect((await first).code).toBe("request_aborted");
    expect((await second).code).toBe("wait_timeout");
  });
  test.each(["failed", "canceled"] as const)(
    "an observed %s build is not masked by a racing deadline",
    async (status) => {
      const service = new SandboxesService("local", "http://unused.test", 1000);
      const terminal = {
        id: "b",
        imageName: "n",
        status,
        errorCode: "builder_terminal",
        errorMessage: "Build terminated",
      };
      vi.spyOn(service, "getImageBuild").mockImplementationOnce(async (_id, options) => {
        // Model a status response becoming available as cancellation is delivered.
        await new Promise<void>((resolve) =>
          options!.signal!.addEventListener("abort", () => resolve(), { once: true })
        );
        return terminal;
      });
      await expect(service.waitForImageBuild("b", { timeout: 0.001 })).rejects.toMatchObject({
        code: "builder_terminal",
        details: terminal,
        message: "[Hyperbrowser]: Build terminated",
      });
    }
  );
});
