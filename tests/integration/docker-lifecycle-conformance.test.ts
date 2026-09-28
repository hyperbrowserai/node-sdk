import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SandboxesService } from "../../src/services/sandboxes";
import {
  dockerImageDigest,
  packageDockerImageManifest,
} from "../../src/sandbox/image-build/docker-image";

let root: string;
let originalPath: string | undefined;
const digest = "sha256:" + "a".repeat(64);
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "hb-docker-lifetime-"));
  originalPath = process.env.PATH;
  mkdirSync(path.join(root, "bin"));
  writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\n");
});
afterEach(() => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function docker(body: string) {
  const script = path.join(root, "bin", "docker");
  writeFileSync(
    script,
    `#!${process.execPath}\nconst fs = require('fs'); const args = process.argv.slice(2); const root = ${JSON.stringify(root)}; fs.appendFileSync(root+'/calls', JSON.stringify(args)+'\\n');\n${body}\n`
  );
  chmodSync(script, 0o755);
  process.env.PATH = `${path.dirname(script)}:${originalPath}`;
}
function calls(): string[][] {
  return readFileSync(path.join(root, "calls"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
const service = () => new SandboxesService("local", "http://unused", 1000);

test.each([undefined, "owned:tag"])(
  "local build failure cleans only generated tags: %s",
  async (dockerTag) => {
    docker(`if (args[0] === 'buildx') { console.error('build failed'); process.exit(4); }`);
    await expect(
      service().buildImageFromDockerfile({
        contextPath: root,
        imageName: "n",
        remote: false,
        dockerTag,
        buildArgs: { A: "value with spaces" },
      })
    ).rejects.toThrow("build failed");
    const trace = calls();
    expect(trace[0]).toContain("linux/amd64");
    expect(trace[0]).toContain("value with spaces".replace(/^/, "A="));
    expect(trace[0]).toContain("--load");
    expect(trace.length).toBe(dockerTag ? 1 : 2);
    if (!dockerTag) expect(trace[1].slice(0, 2)).toEqual(["image", "rm"]);
  }
);
test.each([
  ['"--platform" requires API version 1.49', true],
  ["unknown flag: --platform", true],
  ["No such image", false],
  ["Cannot connect to the Docker daemon", false],
] as const)("Docker inspection failure precedes HTTP: %s", async (message, unsupported) => {
  docker(`console.error(${JSON.stringify(message)}); process.exit(2);`);
  const sdk = service();
  const lookup = vi.spyOn(sdk, "findReadyImage");
  await expect(sdk.getOrBuildImage({ dockerImage: "local/app" })).rejects.toThrow(
    unsupported ? "API 1.49" : message
  );
  expect(lookup).not.toHaveBeenCalled();
  expect(calls()).toHaveLength(1);
});
test("inspection platform comparison is case insensitive", async () => {
  docker(
    `console.log(JSON.stringify({ Id: ${JSON.stringify(digest)}, Os: 'Linux', Architecture: 'AMD64', Config: {} }));`
  );
  expect(await dockerImageDigest("image")).toBe(digest);
});
test("Docker identity mutation during lookup fails before importing", async () => {
  writeFileSync(path.join(root, "digest"), digest);
  docker(
    `console.log(JSON.stringify({ Id: fs.readFileSync(root+'/digest','utf8'), Os: 'linux', Architecture: 'amd64', Config: {} }));`
  );
  const sdk = service();
  vi.spyOn(sdk, "findReadyImage").mockImplementation(async () => {
    writeFileSync(path.join(root, "digest"), "sha256:" + "b".repeat(64));
    return null;
  });
  const reuse = vi.spyOn(sdk, "reuseDockerImage");
  await expect(sdk.getOrBuildImage({ dockerImage: "local/app" })).rejects.toThrow(
    "Docker image changed"
  );
  expect(reuse).not.toHaveBeenCalled();
  expect(calls()).toHaveLength(2);
});
test("known digest cache hit requires no local Docker", async () => {
  docker("throw new Error('Docker must not run');");
  const sdk = service();
  vi.spyOn(sdk, "findReadyImage").mockResolvedValue({
    id: "image",
    imageName: "n",
    namespace: "ns",
    uploaded: true,
    createdAt: "",
    updatedAt: "",
  });
  expect(
    await sdk.getOrBuildImage({ dockerImage: "local/app", expectedImageDigest: digest })
  ).toMatchObject({ outcome: "reused", imageId: "image" });
  expect(readdirSync(root)).not.toContain("calls");
});
test("container inspection fallback and exact reuse preserve env and remove owned container", async () => {
  docker(`
if (args[0] === 'image') process.exit(1);
if (args[0] === 'create') console.log('owned-container');
else if (args[0] === 'container') console.log(args.includes('{{.Image}}') ? ${JSON.stringify(digest)} : JSON.stringify({ User:'node', Env:['PATH=/usr/local/bin','APP=1'], Cmd:['node'], WorkingDir:'/app' }));
else if (args[0] !== 'rm') process.exit(2);`);
  const sdk = service();
  const reuse = vi
    .spyOn(sdk, "reuseDockerImage")
    .mockResolvedValue({
      hit: true,
      build: { id: "b", imageName: "n", status: "completed", imageId: "image" },
    });
  expect((await sdk.buildImageFromDockerImage({ dockerImage: "app", imageName: "n" })).id).toBe(
    "b"
  );
  expect(reuse.mock.calls[0][0]).toMatchObject({
    imageConfigUser: "node",
    imageInit: { env: { APP: "1" }, workingDir: "/app" },
  });
  expect(calls().at(-1)).toEqual(["rm", "-f", "owned-container"]);
  expect(calls().some((args) => args.includes("save"))).toBe(false);
});
test("archive parse failure terminates and reaps Docker save before removing workspace", async () => {
  docker(`
fs.writeFileSync(root+'/pid',String(process.pid));
process.on('SIGTERM', () => { fs.writeFileSync(root+'/terminated','yes'); process.exit(0); });
process.stdout.write(Buffer.alloc(512, 0x61));
setInterval(() => {}, 1000);`);
  await expect(packageDockerImageManifest("app", digest, {}, { tempDir: root })).rejects.toThrow();
  const pid = Number(readFileSync(path.join(root, "pid"), "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  expect(readdirSync(root).filter((entry) => entry.startsWith("hb-docker-image-layers-"))).toEqual(
    []
  );
});
