import { deriveAutoImageInit, mergeImageInit } from "../../src/sandbox/image-build/image-init";
import { HyperbrowserError } from "../../src/error";
import { ProcessOutput } from "../../src/sandbox/process-output";
import { imageBuildName, ImageBuildNameOptions } from "../../src/sandbox/image-build/resolution";
import { expect, test } from "vitest";
import { readFileSync } from "fs";
import path from "path";
// Preserve literal __proto__ keys; transformed JSON object literals can lose them.
const reference: typeof import("../fixtures/python_reference.json") = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/python_reference.json"), "utf8")
);
import { DockerIgnoreMatcher } from "../../src/sandbox/image-build/dockerignore";
import { analyzeDockerfileSources } from "../../src/sandbox/image-build/dockerfile-analysis";

test.each(reference.ignore)("Python ignore: $pattern → $path", ({ pattern, path, expected }) => {
  expect(DockerIgnoreMatcher.fromText(pattern).matches(path)).toBe(expected);
});
test.each(reference.invalidIgnore)("Python rejects invalid ignore %s", (pattern) => {
  expect(() => DockerIgnoreMatcher.fromText(pattern)).toThrow();
});
test.each(reference.dockerfile)(
  "Python Dockerfile: $dockerfile",
  ({ dockerfile, groups, fallback }) => {
    expect(analyzeDockerfileSources(Buffer.from(dockerfile))).toEqual({
      groups,
      fallbackReason: fallback,
    });
  }
);
test("invalid UTF-8 Dockerfiles fall back to full context", () => {
  expect(analyzeDockerfileSources(Buffer.from([0xff]))).toEqual({
    groups: [],
    fallbackReason: "dockerfile_parse_failed",
  });
});
test("ignore preprocessing, comments and root match Python", () => {
  const matcher = DockerIgnoreMatcher.fromText(
    "\ufeff# comment\n  /build/../node_modules/  \n! /node_modules/keep.js\n"
  );
  expect(matcher.hasNegations).toBe(true);
  expect(matcher.matches("node_modules/drop.js")).toBe(true);
  expect(matcher.matches("node_modules/keep.js")).toBe(false);
  expect(matcher.matches("nested/node_modules/drop.js")).toBe(false);
  expect(DockerIgnoreMatcher.fromText(" #literal\n# actual comment\n").matches("#literal")).toBe(
    true
  );
  expect(DockerIgnoreMatcher.fromText("**\n").matches(".")).toBe(false);
});

test.each(reference.imageNames)(
  "image identity matches Python: $options",
  ({ options, expected }) => {
    expect(imageBuildName(options as ImageBuildNameOptions)).toBe(expected);
  }
);
test.each(reference.processes)("process collection matches Python: $name", (fixture) => {
  const output = new ProcessOutput("p", fixture.limit);
  const consume = () => {
    for (const event of fixture.events) output.consume(event);
  };
  if ("error" in fixture) {
    let caught: unknown;
    try {
      consume();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HyperbrowserError);
    expect(caught).toMatchObject(fixture.error!);
  } else {
    consume();
    expect(output.result).toMatchObject(fixture.expected!);
  }
});

test.each(reference.imageInit)(
  "Docker initialization matches Python: $config / $explicit",
  (fixture) => {
    const automatic = deriveAutoImageInit(fixture.config);
    expect(automatic ?? null).toEqual(fixture.automatic);
    expect(mergeImageInit(automatic, fixture.explicit ?? undefined) ?? null).toEqual(
      fixture.expected
    );
  }
);
