/* Validate shipped files and declarations from a fresh npm consumer. */
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const consumer = mkdtempSync(path.join(tmpdir(), "hb-sdk-consumer-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc")], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync(npm, ["pack", "--ignore-scripts", "--silent", "--pack-destination", consumer], {
    cwd: root,
    stdio: "pipe",
  });
  // npm 10 can print prepare output even with --ignore-scripts and --json.
  const tarballs = readdirSync(consumer).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error("Expected one packed SDK tarball");
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  execFileSync(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(consumer, tarballs[0])],
    { cwd: consumer, stdio: "inherit" }
  );
  const common = `
    const assert = require('node:assert/strict');
    const SDK = require('@hyperbrowser/sdk');
    assert.equal(typeof SDK, 'function');
    assert.equal(SDK, SDK.Hyperbrowser);
    assert.equal(typeof SDK.imageBuildName, 'function');
    assert.equal(typeof SDK.dockerBuildContextFingerprint, 'function');
    assert.equal(require('@hyperbrowser/sdk/image-builds').DockerBuildContextChangedError, SDK.DockerBuildContextChangedError);
    assert.equal(typeof require('@hyperbrowser/sdk/sandbox').SandboxFileWatchHandle, 'function');
    require('@hyperbrowser/sdk/types'); require('@hyperbrowser/sdk/tools');
  `;
  writeFileSync(path.join(consumer, "common.cjs"), common);
  writeFileSync(
    path.join(consumer, "module.mjs"),
    `
    import assert from 'node:assert/strict';
    import SDK, { Hyperbrowser, imageBuildName, DockerBuildContextChangedError } from '@hyperbrowser/sdk';
    import { dockerBuildContextFingerprint } from '@hyperbrowser/sdk/image-builds';
    import { SandboxHandle, SandboxFileWatchHandle } from '@hyperbrowser/sdk/sandbox';
    assert.equal(SDK, Hyperbrowser);
    for (const fn of [imageBuildName, DockerBuildContextChangedError, dockerBuildContextFingerprint, SandboxHandle, SandboxFileWatchHandle]) assert.equal(typeof fn, 'function');
  `
  );
  writeFileSync(
    path.join(consumer, "types.mts"),
    `
    import { Hyperbrowser, dockerBuildContextFingerprint, imageBuildName } from '@hyperbrowser/sdk';
    import type { StartSandboxFromSnapshotParams, SandboxRuntimeSession, SandboxFileWatchStreamEvent } from '@hyperbrowser/sdk/types';
    import type { ImageBuildNameOptions } from '@hyperbrowser/sdk/image-builds';
    import type { SandboxFileWatchHandle } from '@hyperbrowser/sdk/sandbox';
    const client = new Hyperbrowser({ apiKey: 'typecheck' });
    const params: StartSandboxFromSnapshotParams = { snapshotName: 'saved' };
    async function check() {
      const sandbox = await client.sandboxes.startFromSnapshot(params);
      const session: SandboxRuntimeSession = await sandbox.createRuntimeSession();
      const watch: SandboxFileWatchHandle = await sandbox.files.getWatch('id', true);
      for await (const event of watch.events({ cursor: 1 })) { const typed: SandboxFileWatchStreamEvent = event; void typed; }
      await sandbox.files.uploadStream('/file', (async function* () { yield new Uint8Array([1]); })(), { contentLength: 1 });
      for await (const bytes of sandbox.files.downloadStream('/file')) bytes.readUInt8(0);
      const naming: ImageBuildNameOptions = { source: 'dockerfile', fingerprint: await dockerBuildContextFingerprint('.') };
      imageBuildName(naming); void session;
    }
    void check;
  `
  );
  for (const entry of ["common.cjs", "module.mjs"])
    execFileSync(process.execPath, [path.join(consumer, entry)], {
      cwd: consumer,
      stdio: "inherit",
    });
  execFileSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2020",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "types.mts",
    ],
    { cwd: consumer, stdio: "inherit" }
  );
  console.log("Packed CommonJS, ESM, subpath exports, and consumer types passed.");
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
