/**
 * Intent: verify file APIs, watch/presign helpers, and structured errors for
 * missing paths or unsupported mutations.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient, testName } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

async function nextWatchEvent(
  watch: Awaited<ReturnType<SandboxHandle["files"]["watch"]>>
) {
  for await (const event of watch.events({ route: "stream" })) {
    if (event.type === "event") {
      return event.event;
    }
  }

  throw new Error("watch stream ended before an event was received");
}

const client = createClient();

describe.sequential("sandbox files e2e", () => {
  let sandbox: SandboxHandle | null = null;
  const baseDir = `/tmp/${testName("sdk-files")}`;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-files"));
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("exists returns false for a missing path", async () => {
    const exists = await sandbox!.files.exists(`${baseDir}/missing.txt`);
    expect(exists).toBe(false);
  });

  test("mkdir creates the base directory", async () => {
    const result = await sandbox!.files.mkdir(baseDir, { parents: true });
    expect(result.path).toBe(baseDir);
  });

  test("writeText and readText round-trip UTF-8 content", async () => {
    await sandbox!.files.writeText(`${baseDir}/hello.txt`, "hello from sdk files");
    const content = await sandbox!.files.readText(`${baseDir}/hello.txt`);
    expect(content).toBe("hello from sdk files");
  });

  test("readText supports offset and length", async () => {
    const chunk = await sandbox!.files.readText(`${baseDir}/hello.txt`, {
      offset: 6,
      length: 4,
    });
    expect(chunk).toBe("from");
  });

  test("writeBytes and readBytes round-trip binary content", async () => {
    const source = Buffer.from([0, 1, 2, 3, 4]);
    await sandbox!.files.writeBytes(`${baseDir}/bytes.bin`, source);
    const content = await sandbox!.files.readBytes(`${baseDir}/bytes.bin`);
    expect(content.equals(source)).toBe(true);
  });

  test("stat and list return file metadata", async () => {
    const stat = await sandbox!.files.stat(`${baseDir}/hello.txt`);
    expect(stat.name).toBe("hello.txt");

    const listing = await sandbox!.files.list(baseDir);
    expect(listing.entries.some((entry) => entry.name === "hello.txt")).toBe(true);
  });

  test("upload and download transfer file bytes", async () => {
    const uploaded = await sandbox!.files.upload(
      `${baseDir}/upload.txt`,
      "uploaded from sdk"
    );
    expect(uploaded.bytesWritten).toBeGreaterThan(0);

    const downloaded = await sandbox!.files.download(`${baseDir}/upload.txt`);
    expect(downloaded.toString("utf8")).toBe("uploaded from sdk");
  });

  test("move and copy relocate files", async () => {
    const moved = await sandbox!.files.move({
      source: `${baseDir}/hello.txt`,
      destination: `${baseDir}/hello-moved.txt`,
    });
    expect(moved.to).toBe(`${baseDir}/hello-moved.txt`);

    const copied = await sandbox!.files.copy({
      source: `${baseDir}/hello-moved.txt`,
      destination: `${baseDir}/hello-copy.txt`,
    });
    expect(copied.to).toBe(`${baseDir}/hello-copy.txt`);
  });

  test("chmod updates file metadata", async () => {
    await sandbox!.files.chmod({
      path: `${baseDir}/hello-copy.txt`,
      mode: "0640",
    });
    const stat = await sandbox!.files.stat(`${baseDir}/hello-copy.txt`);
    expect(stat.mode).toContain("640");
  });

  test("chown failures come back as structured runtime errors when not permitted", async () => {
    await expectHyperbrowserError(
      "file chown",
      () =>
        sandbox!.files.chown({
          path: `${baseDir}/hello-copy.txt`,
          uid: 0,
          gid: 0,
        }),
      {
        statusCode: 400,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["operation", "permission"],
      }
    ).catch(async (error) => {
      if (
        error instanceof Error &&
        /expected HyperbrowserError, but call succeeded/.test(error.message)
      ) {
        const stat = await sandbox!.files.stat(`${baseDir}/hello-copy.txt`);
        expect(stat.name).toBe("hello-copy.txt");
        return;
      }
      throw error;
    });
  });

  test("watch streams file change events", async () => {
    const watch = await sandbox!.files.watch(baseDir, { recursive: false });
    try {
      const eventPromise = nextWatchEvent(watch);
      await sandbox!.files.writeText(`${baseDir}/watch.txt`, "watch me");
      const event = await eventPromise;
      expect(event.path).toContain("watch.txt");

      const fetched = await sandbox!.files.getWatch(watch.id, true);
      expect(fetched.id).toBe(watch.id);
      expect(fetched.current.path).toBe(baseDir);
    } finally {
      await watch.stop();
    }
  });

  test("uploadUrl and downloadUrl return structured presign metadata", async () => {
    const upload = await sandbox!.files.uploadUrl(`${baseDir}/presign-upload.txt`);
    expect(upload.path).toBe(`${baseDir}/presign-upload.txt`);
    expect(upload.url.length).toBeGreaterThan(0);

    const download = await sandbox!.files.downloadUrl(`${baseDir}/upload.txt`);
    expect(download.path).toBe(`${baseDir}/upload.txt`);
    expect(download.method).toBe("GET");
  });

  test("delete removes files and directories", async () => {
    const deletedFile = await sandbox!.files.delete(`${baseDir}/hello-copy.txt`);
    expect(deletedFile.path).toBe(`${baseDir}/hello-copy.txt`);

    const deletedDir = await sandbox!.files.delete(baseDir, { recursive: true });
    expect(deletedDir.path).toBe(baseDir);
    const exists = await sandbox!.files.exists(baseDir);
    expect(exists).toBe(false);
  });

  test("missing file reads return structured errors", async () => {
    await expectHyperbrowserError(
      "missing file read",
      () => sandbox!.files.readText(`${baseDir}/still-missing.txt`),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["not found", "no such file"],
      }
    );
  });

  test("missing file deletes return structured errors", async () => {
    await expectHyperbrowserError(
      "missing file delete",
      () => sandbox!.files.delete(`${baseDir}/still-missing.txt`),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["not found", "no such file"],
      }
    );
  });
});
