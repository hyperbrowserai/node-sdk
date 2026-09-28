import { createHash } from "crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PaxTarWriter } from "../../src/sandbox/image-build/tar";
import {
  dockerImageDigest,
  packageDockerImageManifest,
  prepareDockerImageManifestSource,
} from "../../src/sandbox/image-build/docker-image";
import { deriveAutoImageInit, mergeImageInit } from "../../src/sandbox/image-build/image-init";
import { SandboxesService } from "../../src/services/sandboxes";
import { localHTTP } from "../helpers/local-http";

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

let workspace: string;
let originalPath: string | undefined;

const writeTar = async (entries: Array<[string, Buffer]>): Promise<string> => {
  const chunks: Buffer[] = [];
  const writer = new PaxTarWriter(async (chunk: Buffer) => {
    chunks.push(chunk);
  });
  for (const [name, data] of entries) {
    await writer.addEntry(
      { name, type: "file", mode: 0o644, size: data.length, linkname: "" },
      (async function* () {
        yield data;
      })()
    );
  }
  await writer.close();
  const archive = path.join(workspace, "image.tar");
  writeFileSync(archive, Buffer.concat(chunks));
  return archive;
};

/** A stand-in `docker` CLI answering inspect/save from fixture files. */
const installFakeDocker = (
  inspection: Record<string, unknown>,
  archive: string,
  saveExit = 0
): void => {
  const bin = path.join(workspace, "bin");
  rmSync(bin, { recursive: true, force: true });
  require("fs").mkdirSync(bin);
  writeFileSync(path.join(workspace, "inspect.json"), JSON.stringify(inspection));
  const script = `#!/bin/sh
if [ "$1" = "buildx" ] || { [ "$1" = "image" ] && [ "$2" = "rm" ]; }; then
  exit 0
fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  cat "${path.join(workspace, "inspect.json")}"
  exit 0
fi
if [ "$1" = "image" ] && [ "$2" = "save" ]; then
  cat "${archive}"
  exit ${saveExit}
fi
echo "unexpected docker invocation: $*" >&2
exit 1
`;
  writeFileSync(path.join(bin, "docker"), script);
  chmodSync(path.join(bin, "docker"), 0o755);
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
};

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "hb-docker-image-"));
  originalPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(workspace, { recursive: true, force: true });
});

describe("docker image manifest packaging", () => {
  const configBytes = Buffer.from('{"architecture":"amd64","config":{}}');
  const layerBytes = Buffer.from("reusable-layer-tar");
  const saveManifest = Buffer.from(
    JSON.stringify([{ Config: "config.json", Layers: ["layer.tar"] }])
  );

  test.each(
    ["remote-dockerfile", "local-dockerfile", "image"].flatMap((source) =>
      [false, true].map((custom) => ({ source, custom }))
    )
  )("forwards builder resources through $source (custom=$custom)", async ({ source, custom }) => {
    const archive = await writeTar([
      ["config.json", configBytes],
      ["layer.tar", layerBytes],
      ["manifest.json", saveManifest],
    ]);
    installFakeDocker(
      { Id: `sha256:${sha256(configBytes)}`, Os: "linux", Architecture: "amd64", Config: {} },
      archive
    );
    writeFileSync(path.join(workspace, "Dockerfile"), "FROM scratch\n");
    let captured: Record<string, unknown> | undefined;
    const build = { id: "b", imageName: "n", status: "completed", imageId: "image" };
    const server = await localHTTP(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.url === "/api/images/builds/reuse") {
        res.end('{"hit":false}');
        return;
      }
      if (req.url === "/api/images/builds") {
        captured = JSON.parse(Buffer.concat(chunks).toString());
        res.end(JSON.stringify({ build, uploads: [] }));
        return;
      }
      expect(req.url).toBe("/api/images/builds/b/complete");
      res.end(JSON.stringify({ build }));
    });
    try {
      const sdk = new SandboxesService("test", server.url, 1000);
      const options = {
        imageName: "n",
        wait: false,
        ...(custom
          ? {
              builderCpus: 8,
              builderMemoryMiB: 16384,
              builderScratchMiB: 65536,
            }
          : {}),
      };
      const result =
        source === "image"
          ? await sdk.buildImageFromDockerImage({ ...options, dockerImage: "local/app" })
          : await sdk.buildImageFromDockerfile({
              ...options,
              contextPath: workspace,
              remote: source === "remote-dockerfile",
            });
      expect(result.id).toBe("b");
      expect(captured).toBeDefined();
      expect(captured!.vcpus).toBe(custom ? 8 : undefined);
      expect(captured!.memMiB).toBe(custom ? 16384 : undefined);
      expect(captured!.scratchMiB).toBe(custom ? 65536 : undefined);
      expect(captured).not.toHaveProperty("builderCpus");
    } finally {
      await server.close();
    }
  });

  test("streams docker save into verified reusable layers plus a manifest", async () => {
    const archive = await writeTar([
      ["config.json", configBytes],
      ["layer.tar", layerBytes],
      ["manifest.json", saveManifest],
    ]);
    const digest = `sha256:${sha256(configBytes)}`;
    installFakeDocker(
      { Id: digest, Os: "linux", Architecture: "amd64", Config: { User: "node", Env: ["A=1"] } },
      archive
    );
    await expect(dockerImageDigest("local/app:latest")).resolves.toBe(digest);
    const source = await prepareDockerImageManifestSource("local/app:latest");
    expect(source.imageDigest).toBe(digest);
    expect(source.imageConfigUser).toBe("node");
    expect(source.imageInit).toEqual({ env: { A: "1" } });
    await source.cleanup();

    const packaged = await packageDockerImageManifest("local/app:latest", digest, source.config, {
      tempDir: workspace,
    });
    try {
      expect(packaged.artifact.inputFormat).toBe("docker_image_manifest_v1");
      expect(packaged.manifest.imageDigest).toBe(digest);
      expect(packaged.manifest.config.sha256).toBe(sha256(configBytes));
      expect(packaged.manifest.layers.map((layer) => layer.sha256)).toEqual([sha256(layerBytes)]);
      expect(readFileSync(packaged.layers[sha256(layerBytes)].path)).toEqual(layerBytes);
    } finally {
      packaged.cleanup();
    }
  });

  test("rejects non-amd64 local images with rebuild guidance", async () => {
    const archive = await writeTar([]);
    installFakeDocker(
      { Id: `sha256:${"a".repeat(64)}`, Os: "linux", Architecture: "arm64", Config: {} },
      archive
    );
    await expect(dockerImageDigest("local/app:latest")).rejects.toThrow(/expected linux\/amd64/);
  });

  test.each(["../escape.tar", "/abs/layer.tar", "dir/../layer.tar"])(
    "rejects unsafe docker save entry path %s",
    async (unsafe) => {
      const archive = await writeTar([
        ["config.json", configBytes],
        [unsafe, layerBytes],
        [
          "manifest.json",
          Buffer.from(JSON.stringify([{ Config: "config.json", Layers: [unsafe] }])),
        ],
      ]);
      const digest = `sha256:${sha256(configBytes)}`;
      installFakeDocker({ Id: digest, Os: "linux", Architecture: "amd64", Config: {} }, archive);
      await expect(
        packageDockerImageManifest("local/app:latest", digest, {}, { tempDir: workspace })
      ).rejects.toThrow(/unsafe entry path/);
    }
  );

  test("rejects a config that does not match the inspected digest", async () => {
    const archive = await writeTar([
      ["config.json", configBytes],
      ["layer.tar", layerBytes],
      ["manifest.json", saveManifest],
    ]);
    const digest = `sha256:${"b".repeat(64)}`;
    installFakeDocker({ Id: digest, Os: "linux", Architecture: "amd64", Config: {} }, archive);
    await expect(
      packageDockerImageManifest("local/app:latest", digest, {}, { tempDir: workspace })
    ).rejects.toThrow();
  });

  test("rejects a failing docker save", async () => {
    const archive = await writeTar([
      ["config.json", configBytes],
      ["layer.tar", layerBytes],
      ["manifest.json", saveManifest],
    ]);
    const digest = `sha256:${sha256(configBytes)}`;
    installFakeDocker({ Id: digest, Os: "linux", Architecture: "amd64", Config: {} }, archive, 3);
    await expect(
      packageDockerImageManifest("local/app:latest", digest, {}, { tempDir: workspace })
    ).rejects.toThrow();
  });
});

describe("image init derivation", () => {
  test("derives env, args and working dir while excluding reserved variables", () => {
    const init = deriveAutoImageInit({
      Env: ["PATH=/usr/bin", "HOME=/root", "APP=1", "SANDBOX_ENABLED=x"],
      Cmd: ["node", "server.js"],
      WorkingDir: "/srv",
    });
    expect(init?.workingDir).toBe("/srv");
    expect(init?.env).toMatchObject({ APP: "1" });
    expect(init?.env?.SANDBOX_ENABLED).toBeUndefined();
    expect(init?.env?.HOME).toBeUndefined();
    expect(init?.args ?? init?.command).toBeTruthy();
  });

  test("explicit values override automatic defaults", () => {
    const merged = mergeImageInit(
      { env: { A: "auto", B: "auto" }, workingDir: "/auto" },
      { env: { B: "explicit" }, command: "/bin/sh" }
    );
    expect(merged).toMatchObject({
      env: { A: "auto", B: "explicit" },
      workingDir: "/auto",
      command: "/bin/sh",
    });
    expect(mergeImageInit(undefined, undefined)).toBeUndefined();
  });
});
