import { createHash, randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vitest";
import { HyperbrowserError } from "../../../src/client";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient } from "../../helpers/config";
import { fetchRuntimeUrl } from "../../helpers/http";
import { stopSandboxIfRunning, waitForRuntimeReady } from "../../helpers/sandbox";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const testVolumes = process.env.HYPERBROWSER_SMOKE_VOLUMES !== "0";

// Uses unique resources and deletes only those it owns.
test("remote image build through sandbox, streaming files, watch, exposure and snapshot restore", async () => {
  const client = createClient();
  const context = await mkdtemp(join(tmpdir(), "node-parity-smoke-"));
  const name = `sdk-parity-${randomUUID().slice(0, 8)}`;
  const sandboxes: SandboxHandle[] = [];
  let buildId: string | undefined;
  let imageId: string | undefined;
  let volumeId: string | undefined;
  let snapshotId: string | undefined;
  let primaryError: unknown;
  try {
    await writeFile(
      join(context, "Dockerfile"),
      "FROM node:22-bookworm-slim\nCOPY marker /sdk-parity-marker\n"
    );
    await writeFile(join(context, "marker"), name);
    const submitted = await client.sandboxes.getOrBuildImage({
      contextPath: context,
      imageNamePrefix: name,
      wait: false,
    });
    buildId = submitted.build?.id;
    const build = buildId
      ? await client.sandboxes.waitForImageBuild(buildId, { timeout: 600, pollInterval: 2 })
      : undefined;
    imageId = submitted.imageId ?? build?.imageId ?? undefined;
    expect(imageId).toBeTruthy();
    const reused = await client.sandboxes.getOrBuildImage({
      contextPath: context,
      imageNamePrefix: name,
    });
    expect(reused.outcome).toBe("reused");
    expect(reused.imageId).toBe(imageId);

    if (testVolumes) {
      volumeId = (await client.volumes.create({ name })).id;
      expect((await client.volumes.get(volumeId)).id).toBe(volumeId);
    } else
      console.log(
        "parity smoke: volume checks explicitly disabled by HYPERBROWSER_SMOKE_VOLUMES=0"
      );
    const mounts = volumeId ? { "/workspace": { id: volumeId, type: "rw" as const } } : undefined;
    const sandbox = await client.sandboxes.create({
      imageName: submitted.imageName,
      imageId,
      mounts,
      timeoutMinutes: 15,
    });
    sandboxes.push(sandbox);
    await waitForRuntimeReady(sandbox);
    await sandbox.files.mkdir("/workspace");
    expect((await sandbox.exec("cat /sdk-parity-marker")).stdout).toBe(name);
    const session = await sandbox.createRuntimeSession({ forceRefresh: true });
    expect(session.sandboxId).toBe(sandbox.id);
    expect(session.token).toBeTruthy();
    const output = await sandbox.exec({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(512*1024));process.stderr.write('stderr-ok')"],
    });
    expect(output.stdout).toBe("x".repeat(512 * 1024));
    expect(output.stderr).toBe("stderr-ok");

    const chunk = Buffer.alloc(64 * 1024, 0x5a);
    const expected = createHash("sha256");
    await sandbox.files.uploadStream(
      "/workspace/large.bin",
      (async function* () {
        for (let i = 0; i < 320; i++) {
          expected.update(chunk);
          yield chunk;
        }
      })(),
      { contentLength: chunk.length * 320 }
    );
    const actual = createHash("sha256");
    let downloaded = 0;
    for await (const bytes of sandbox.files.downloadStream("/workspace/large.bin")) {
      actual.update(bytes);
      downloaded += bytes.length;
    }
    expect(downloaded).toBe(20 * 1024 * 1024);
    expect(actual.digest("hex")).toBe(expected.digest("hex"));
    const watch = await sandbox.files.watch("/workspace");
    const resumed = await sandbox.files.getWatch(watch.id, true);
    expect((await resumed.refresh()).current.active).toBe(true);
    const events: string[] = [];
    const watching = (async () => {
      for await (const event of resumed.events({
        cursor: 0,
        signal: AbortSignal.timeout(30_000),
      })) {
        if (event.type === "event") events.push(event.event.path);
        else expect(event.status.active).toBe(false);
      }
    })();
    // Observe rejection immediately while mutations run concurrently.
    watching.catch(() => {});
    try {
      await sandbox.files.write("/workspace/watched.txt", name);
      const until = Date.now() + 10_000;
      while (!events.some((path) => path.endsWith("watched.txt")) && Date.now() < until)
        await delay(100);
      expect(events.some((path) => path.endsWith("watched.txt"))).toBe(true);
    } finally {
      await watch.stop();
      await watching;
    }
    expect(resumed.current.active).toBe(false);

    const server = await sandbox.processes.start({
      command: "node",
      args: [
        "-e",
        "require('http').createServer((req,res)=>res.end('parity-http-ok')).listen(3210,'0.0.0.0')",
      ],
    });
    try {
      const exposure = await sandbox.expose({ port: 3210, auth: true });
      let body = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetchRuntimeUrl(exposure.url, {
          headers: { Authorization: `Bearer ${session.token}` },
          timeout: 10_000,
        });
        body = await response.text();
        if (response.ok && body === "parity-http-ok") break;
        await delay(250);
      }
      expect(body).toBe("parity-http-ok");
      expect((await sandbox.unexpose(3210)).exposed).toBe(false);
    } finally {
      await server.kill();
      server.disconnect();
    }
    await sandbox.files.write("/tmp/snapshot-marker", name);
    const snapshot = await sandbox.createMemorySnapshot();
    snapshotId = snapshot.snapshotId;
    const deadline = Date.now() + 180_000;
    while ((await client.sandboxes.getSnapshot(snapshotId)).status !== "created") {
      if (Date.now() >= deadline) throw new Error("Snapshot did not become ready");
      await delay(1000);
    }
    await sandbox.stop();
    let restored: SandboxHandle;
    // Snapshot metadata can precede distribution to the target runner.
    for (;;) {
      try {
        restored = await client.sandboxes.startFromSnapshot({
          snapshotName: snapshot.snapshotName,
          snapshotId,
          mounts,
          timeoutMinutes: 5,
        });
        break;
      } catch (error) {
        if (
          !(error instanceof HyperbrowserError) ||
          error.statusCode !== 404 ||
          !/snapshot not found/i.test(error.message) ||
          Date.now() >= deadline
        )
          throw error;
        await delay(3000);
      }
    }
    sandboxes.push(restored);
    await waitForRuntimeReady(restored);
    expect(await restored.files.read("/tmp/snapshot-marker")).toBe(name);
    expect((await restored.files.stat("/workspace/large.bin")).size).toBe(20 * 1024 * 1024);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const cleanup = async (operation: () => Promise<unknown>, waitForBackup = false) => {
      const deadline = Date.now() + 180_000;
      for (;;) {
        try {
          await operation();
          return;
        } catch (error) {
          if (
            waitForBackup &&
            error instanceof HyperbrowserError &&
            error.statusCode === 409 &&
            /backup.*in progress/i.test(error.message) &&
            Date.now() < deadline
          ) {
            await delay(2000);
            continue;
          }
          cleanupErrors.push(error);
          return;
        }
      }
    };
    for (const sandbox of sandboxes.reverse()) await cleanup(() => stopSandboxIfRunning(sandbox));
    if (buildId && !imageId)
      await cleanup(async () => {
        const build = await client.sandboxes.getImageBuild(buildId!);
        imageId = build.imageId ?? undefined;
        if (!["completed", "failed", "canceled"].includes(build.status))
          await client.sandboxes.cancelImageBuild(buildId!);
      });
    if (snapshotId) await cleanup(() => client.sandboxes.deleteSnapshot(snapshotId!));
    if (volumeId) await cleanup(() => client.volumes.delete(volumeId!));
    if (imageId) await cleanup(() => client.sandboxes.deleteImage(imageId!), true);
    await cleanup(() => rm(context, { recursive: true, force: true }));
    if (cleanupErrors.length) {
      if (primaryError) console.error("parity smoke cleanup failures:", cleanupErrors);
      else
        throw new Error(
          `Parity smoke resource cleanup failed: ${cleanupErrors.map(String).join("; ")}`
        );
    }
  }
}, 1_000_000);
