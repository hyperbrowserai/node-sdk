import { createHash } from "crypto";
import { chmodSync, cpSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { createGunzip } from "zlib";
import { afterEach, describe, expect, test } from "vitest";
import {
  DockerBuildContextChangedError,
  dockerBuildContextFingerprint,
  packageDockerBuildContextManifest,
} from "../../src/sandbox/image-build/context";
import { readTarEntries } from "../../src/sandbox/image-build/tar";
import { imageBuildName } from "../../src/sandbox/image-build/resolution";
import { lchmodSync, rmSync } from "fs";

const tempDirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "hb-fingerprint-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const context = (root: string, dockerfile = "FROM scratch\nCOPY . /app\n", ignore = ""): string => {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "Dockerfile"), dockerfile);
  writeFileSync(path.join(root, ".dockerignore"), ignore);
  mkdirSync(path.join(root, "app"));
  writeFileSync(path.join(root, "app", "main.py"), "print('hello')\n");
  writeFileSync(path.join(root, "app", "debug.log"), "diagnostics\n");
  writeFileSync(path.join(root, "unused"), "not copied by sparse builds\n");
  return root;
};

const collect = async (chunks: AsyncIterable<Buffer>): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
};

describe("docker build context fingerprint", () => {
  test("matches the Python SDK's golden fingerprint byte for byte", async () => {
    const root = tempDir();
    writeFileSync(path.join(root, "Dockerfile"), Buffer.from("FROM scratch\nCOPY . /app\n"));
    chmodSync(path.join(root, "Dockerfile"), 0o644);
    const folder = path.join(root, "long-path-" + "x".repeat(110));
    mkdirSync(folder);
    chmodSync(folder, 0o755);
    writeFileSync(path.join(folder, "unicode-ü.txt"), Buffer.from("canonical\x00payload\n"));
    chmodSync(path.join(folder, "unicode-ü.txt"), 0o640);
    writeFileSync(path.join(root, "empty"), Buffer.alloc(0));
    chmodSync(path.join(root, "empty"), 0o600);
    symlinkSync("empty", path.join(root, "link"));
    // Fingerprints include permissions; create the same metadata as Python.
    if (process.platform === "darwin") lchmodSync(path.join(root, "link"), 0o777);

    await expect(dockerBuildContextFingerprint(root)).resolves.toBe(
      "8d66062b58007e23ed8844b026726ac24e4ea5b32e4d6c3e4590d48b252755f9"
    );
  });

  const cases: Array<[string, string]> = [
    ["FROM scratch\nCOPY app /app\n", ""],
    ["FROM scratch\nCOPY . /app\n", "**/*.log\n"],
    ["FROM scratch\nCOPY . /app\n", "app\n!app/main.py\n"],
    ["FROM scratch\nCOPY app /app\nCOPY app/main.py /main\n", ""],
    ["FROM scratch\nCOPY app/*.py /app/\n", "unused\n"],
    ["FROM scratch\nARG SRC=app\nCOPY $SRC /app\n", ""],
    ["FROM scratch\n", "*\n"],
    ["FROM scratch AS source\nCOPY app /app\nFROM scratch\nCOPY --from=source /app /app\n", ""],
    ["FROM busybox\nRUN --mount=type=bind,source=app,target=/app cat /app/main.py\n", ""],
    ["FROM scratch\nCOPY <<EOF /hello\nhello\nEOF\n", ""],
    ["FROM scratch\nCOPY --chmod=0755 --link app /app\n", ""],
    ["FROM scratch\nADD app /app\n", ""],
    ["# syntax=custom/frontend:1\nFROM scratch\n", ""],
  ];

  for (const full of [false, true]) {
    test.each(cases)(`fingerprint matches archived bytes (full=${full}) %s`, async (dockerfile, ignore) => {
      const root = context(path.join(tempDir(), "context"), dockerfile, ignore);
      const expected = await dockerBuildContextFingerprint(root, { forceFullContext: full });
      const packaged = await packageDockerBuildContextManifest(root, {
        forceFullContext: full,
        expectedContextFingerprint: expected,
      });
      try {
        const hashes: string[] = [];
        for (const artifact of Object.values(packaged.bundles)) {
          const hasher = createHash("sha256");
          const stream = Readable.from([readFileSync(artifact.path)]).pipe(createGunzip());
          for await (const entry of readTarEntries(stream)) {
            const kind = entry.isFile ? "file" : entry.typeflag === "5" ? "directory" : "symlink";
            const content = await collect(entry.content());
            const name = kind === "directory" ? entry.name.replace(/\/+$/, "") : entry.name;
            const metadata = Buffer.from(
              JSON.stringify([name, kind, entry.mode, entry.size, entry.linkname])
            );
            const length = Buffer.alloc(8);
            length.writeBigUInt64BE(BigInt(metadata.length));
            hasher.update(length);
            hasher.update(metadata);
            if (entry.isFile) {
              hasher.update(content);
            }
          }
          hashes.push(hasher.digest("hex"));
        }
        const identity = {
          bundles: [...new Set(hashes)].sort(),
          contextMode: packaged.manifest.contextMode,
          dockerfile: packaged.manifest.dockerfilePath,
          version: 1,
        };
        const actual = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
        expect(expected).toBe(actual);
        expect(packaged.fingerprint).toBe(expected);
      } finally {
        packaged.cleanup();
      }
    });
  }

  test.each([
    ["contents", true],
    ["mode", true],
    ["path", true],
    ["mtime", false],
    ["ignored-file", false],
    ["unused-file", false],
    ["dockerfile", true],
    ["ignore-rules", true],
    ["symlink", true],
  ])("identity tracks effective build inputs: %s", async (change, changesIdentity) => {
    const root = context(path.join(tempDir(), "context"), "FROM scratch\nCOPY app /app\n", "**/*.log\n");
    const before = await dockerBuildContextFingerprint(root);
    const main = path.join(root, "app", "main.py");
    switch (change) {
      case "contents":
        writeFileSync(main, "print('changed')\n");
        break;
      case "mode":
        chmodSync(main, 0o755);
        break;
      case "path":
        cpSync(main, path.join(root, "app", "renamed.py"));
        rmSync(main);
        break;
      case "mtime":
        writeFileSync(main, readFileSync(main));
        break;
      case "ignored-file":
        writeFileSync(path.join(root, "app", "other.log"), "more\n");
        break;
      case "unused-file":
        writeFileSync(path.join(root, "unused"), "changed but not copied\n");
        break;
      case "dockerfile":
        writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\nCOPY app /srv\n");
        break;
      case "ignore-rules":
        writeFileSync(path.join(root, ".dockerignore"), "");
        break;
      case "symlink":
        symlinkSync("main.py", path.join(root, "app", "link"));
        break;
    }
    const after = await dockerBuildContextFingerprint(root);
    expect(after !== before).toBe(changesIdentity);
  });

  test.each([false, true])("hard links preserve all paths and match independent copies (full=%s)", async (full) => {
    const base = tempDir();
    const root = context(path.join(base, "linked"), "FROM scratch\nCOPY app /app\n");
    const first = path.join(root, "app", "main.py");
    const second = path.join(root, "app", "second.py");
    linkSync(first, second);
    symlinkSync("main.py", path.join(root, "app", "link"));
    const copied = path.join(base, "copied");
    cpSync(root, copied, { recursive: true, verbatimSymlinks: true });
    const expected = await dockerBuildContextFingerprint(root, { forceFullContext: full });
    await expect(dockerBuildContextFingerprint(copied, { forceFullContext: full })).resolves.toBe(expected);
    const packaged = await packageDockerBuildContextManifest(root, {
      forceFullContext: full,
      expectedContextFingerprint: expected,
    });
    try {
      const files: Record<string, Buffer> = {};
      for (const artifact of Object.values(packaged.bundles)) {
        const stream = Readable.from([readFileSync(artifact.path)]).pipe(createGunzip());
        for await (const entry of readTarEntries(stream)) {
          const content = await collect(entry.content());
          if (entry.isFile) {
            files[entry.name] = content;
          }
          if (entry.name === "app/link") {
            expect(entry.typeflag).toBe("2");
            expect(entry.linkname).toBe("main.py");
          }
        }
      }
      expect(files["app/main.py"]).toEqual(readFileSync(first));
      expect(files["app/second.py"]).toEqual(readFileSync(first));
    } finally {
      packaged.cleanup();
    }
    writeFileSync(second, "updated through hard link\n");
    await expect(dockerBuildContextFingerprint(root, { forceFullContext: full })).resolves.not.toBe(expected);
  });

  test("mutation is rejected using archived bytes and the workspace is removed", async () => {
    const base = tempDir();
    const root = context(path.join(base, "context"));
    const workspaces = path.join(base, "workspaces");
    mkdirSync(workspaces);
    const expected = await dockerBuildContextFingerprint(root);
    const script = path.join(root, "app", "main.py");
    writeFileSync(script, "x".repeat(readFileSync(script).length));
    await expect(
      packageDockerBuildContextManifest(root, { tempDir: workspaces, expectedContextFingerprint: expected })
    ).rejects.toBeInstanceOf(DockerBuildContextChangedError);
    expect(readdirSync(workspaces)).toEqual([]);
  });

  test.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])(
    "invalid expected fingerprint %j is rejected before packaging",
    async (invalid) => {
      await expect(
        packageDockerBuildContextManifest(path.join(tempDir(), "missing"), {
          expectedContextFingerprint: invalid,
        })
      ).rejects.toThrow(/SHA-256 hex digest/);
    }
  );

  test("image names are content derived and validated", () => {
    const fingerprint = "b".repeat(64);
    const name = imageBuildName({ source: "dockerfile", fingerprint });
    expect(name).toMatch(/^hb__dockerfile__[0-9a-f]{16}__linux-amd64$/);
    expect(imageBuildName({ source: "dockerfile", fingerprint })).toBe(name);
    expect(imageBuildName({ source: "dockerfile", fingerprint, imageInit: {} })).toBe(name);
    expect(
      imageBuildName({ source: "dockerfile", fingerprint, imageInit: { env: { A: "1" } } })
    ).not.toBe(name);
    expect(imageBuildName({ source: "dockerfile", fingerprint, namePrefix: "team" })).toMatch(
      /^team__dockerfile__/
    );
    expect(() => imageBuildName({ source: "dockerfile", fingerprint: "nope" })).toThrow(
      /SHA-256 hex digest/
    );
    expect(() => imageBuildName({ source: "prebuilt", fingerprint })).toThrow(/sha256:/);
    expect(() => imageBuildName({ source: "dockerfile", fingerprint, platform: "linux/arm64" })).not.toThrow();
    expect(() => imageBuildName({ source: "dockerfile", fingerprint, namePrefix: "bad prefix" })).toThrow();
  });
});
