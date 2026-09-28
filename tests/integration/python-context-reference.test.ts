import {
  chmodSync,
  lchmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { expect, test, vi } from "vitest";
import {
  dockerBuildContextFingerprint,
  packageDockerBuildContextManifest,
} from "../../src/sandbox/image-build/context";
import * as gzip from "../../src/sandbox/image-build/gzip";
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
    mkdtempSync: vi.fn(actual.mkdtempSync),
  };
});
const reference: typeof import("../fixtures/python_reference.json") = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/python_reference.json"), "utf8")
);
test.each(reference.contexts)("Python filesystem fingerprint: $name", async (fixture) => {
  const root = mkdtempSync(path.join(tmpdir(), "hb-python-context-"));
  try {
    for (const directory of fixture.directories)
      mkdirSync(path.join(root, directory), { recursive: true, mode: 0o755 });
    for (const [file, content] of Object.entries(fixture.files)) {
      if (content === undefined) continue;
      const location = path.join(root, file);
      mkdirSync(path.dirname(location), { recursive: true, mode: 0o755 });
      writeFileSync(location, content);
      chmodSync(location, (fixture.modes as Record<string, number>)[file] ?? 0o644);
    }
    for (const [link, target] of Object.entries(fixture.links)) {
      if (target !== undefined) {
        const location = path.join(root, link);
        symlinkSync(target, location);
        // macOS applies umask to symlinks; the Python golden uses mode 0777.
        if (process.platform === "darwin") lchmodSync(location, 0o777);
        expect(lstatSync(location).mode & 0o7777).toBe(0o777);
      }
    }
    const compress = vi.spyOn(gzip, "writeGzipTar");
    try {
      expect(await dockerBuildContextFingerprint(root, { forceFullContext: fixture.full })).toBe(
        fixture.expected
      );
      expect(compress).not.toHaveBeenCalled();
    } finally {
      compress.mockRestore();
    }
    const packaged = await packageDockerBuildContextManifest(root, {
      forceFullContext: fixture.full,
      expectedContextFingerprint: fixture.expected,
    });
    try {
      expect(packaged.fingerprint).toBe(fixture.expected);
    } finally {
      packaged.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fingerprinting streams payloads without staging and prunes ignored subtrees", async () => {
  const fs = await import("fs");
  const root = mkdtempSync(path.join(tmpdir(), "hb-fingerprint-stream-"));
  writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\nCOPY . /app\n");
  writeFileSync(path.join(root, ".dockerignore"), "node_modules\n");
  writeFileSync(path.join(root, "payload"), Buffer.alloc(10 * 1024 * 1024, 1));
  mkdirSync(path.join(root, "node_modules", "nested"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "nested", "ignored"), "ignored");
  const read = vi.mocked(fs.readFileSync).mockClear();
  const listing = vi.mocked(fs.readdirSync).mockClear();
  const staging = vi.mocked(fs.mkdtempSync).mockClear();
  const compression = vi.spyOn(gzip, "writeGzipTar");
  try {
    expect(await dockerBuildContextFingerprint(root)).toMatch(/^[a-f0-9]{64}$/);
    expect(read.mock.calls.some(([filename]) => String(filename).endsWith("/payload"))).toBe(false);
    expect(
      listing.mock.calls.some(([directory]) => String(directory).includes("node_modules"))
    ).toBe(false);
    expect(staging).not.toHaveBeenCalled();
    expect(compression).not.toHaveBeenCalled();
  } finally {
    read.mockClear();
    listing.mockClear();
    staging.mockClear();
    compression.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
