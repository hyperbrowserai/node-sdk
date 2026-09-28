import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../fixtures/docker_context_parity.json";
import { analyzeDockerfileSources } from "../../src/sandbox/image-build/dockerfile-analysis";
import { collectContextEntries, loadDockerignore } from "../../src/sandbox/image-build/context";

interface DockerfileCase {
  name: string;
  dockerfile: string;
  goSourceGroups: string[][];
  goFallback: string;
  pythonExpectation: "exact" | "full";
}

interface IgnoreCase {
  name: string;
  dockerignore: string;
  files: string[];
  symlinks?: Array<{ path: string; target: string }>;
  sources?: string[];
  expectedEntries: string[];
}

const dockerfiles = fixture.dockerfiles as DockerfileCase[];
const ignoreContexts = fixture.ignoreContexts as IgnoreCase[];

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("docker context parity with Go/BuildKit fixtures", () => {
  test.each(dockerfiles.map((c) => [c.name, c] as const))(
    "dockerfile analysis matches Go or falls back to full: %s",
    (_name, testCase) => {
      const { groups, fallbackReason } = analyzeDockerfileSources(Buffer.from(testCase.dockerfile));
      if (testCase.pythonExpectation === "exact") {
        expect(testCase.goFallback).toBe("");
        expect(fallbackReason).toBe("");
        expect(groups).toEqual(testCase.goSourceGroups);
      } else {
        expect(testCase.pythonExpectation).toBe("full");
        expect(fallbackReason).not.toBe("");
        expect(groups).toEqual([]);
      }
    }
  );

  test.each(ignoreContexts.map((c) => [c.name, c] as const))(
    "dockerignore context selection matches Go fsutil: %s",
    (_name, testCase) => {
      const root = mkdtempSync(path.join(tmpdir(), "hb-parity-"));
      tempDirs.push(root);
      for (const relative of testCase.files) {
        const destination = path.join(root, relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(
          destination,
          relative === ".dockerignore" ? testCase.dockerignore : `${relative}\n`
        );
      }
      for (const symlink of testCase.symlinks ?? []) {
        const destination = path.join(root, symlink.path);
        mkdirSync(path.dirname(destination), { recursive: true });
        symlinkSync(symlink.target, destination);
      }
      const ignoreMatcher = loadDockerignore(path.join(root, ".dockerignore"));
      const entries = collectContextEntries(root, testCase.sources ?? ["."], {
        ignoreMatcher,
        required: false,
      });
      expect([...entries].sort()).toEqual(testCase.expectedEntries);
    }
  );
});
