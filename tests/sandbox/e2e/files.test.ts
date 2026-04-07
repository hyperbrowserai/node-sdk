/**
 * Intent: verify the filesystem parity surface, rich metadata, raw transfer
 * APIs, watchDir behavior, and signed URL helpers.
 */

import { Blob } from "buffer";
import { ReadableStream } from "node:stream/web";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient, testName } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import { fetchSignedUrl } from "../../helpers/http";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

const client = createClient();

const readStreamText = async (
  stream: ReadableStream<Uint8Array>
): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

const waitForEvent = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const WATCH_TIMEOUT_MS = 10_000;

const isCreateOrWriteEvent = (type: string): boolean => {
  return type === "create" || type === "write";
};

const rejectOnUnexpectedWatchExit = (
  pending: { reject: (error: unknown) => void },
  label: string
) => {
  return async (error?: Error) => {
    pending.reject(error ?? new Error(`${label} watch exited before the expected event`));
  };
};

const createParentSymlinkEscapeFixture = async (
  sandbox: SandboxHandle,
  baseDir: string,
  name: string
) => {
  const allowedDir = `${baseDir}/${name}`;
  const outsideDir = `/var/tmp/${testName(name)}`;
  const outsideFile = `${outsideDir}/secret.txt`;
  const linkDir = `${allowedDir}/evil`;
  const escapedFile = `${linkDir}/secret.txt`;
  const setup = await sandbox.exec({
    runAs: "root",
    command: "bash",
    args: [
      "-lc",
      [
        `mkdir -p "${allowedDir}"`,
        `mkdir -p "${outsideDir}"`,
        `printf 'outside secret' > "${outsideFile}"`,
        `ln -sfn "${outsideDir}" "${linkDir}"`,
      ].join(" && "),
    ],
  });
  expect(setup.exitCode).toBe(0);

  return {
    allowedDir,
    outsideDir,
    outsideFile,
    linkDir,
    escapedFile,
  };
};

describe.sequential("sandbox filesystem e2e", () => {
  let sandbox: SandboxHandle | null = null;
  let files: SandboxHandle["files"];
  const baseDir = `/tmp/${testName("sdk-files")}`;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-files"));
    await waitForRuntimeReady(sandbox);
    files = sandbox.files.withRunAs("root");
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("exists returns false for a missing path", async () => {
    const exists = await files.exists(`${baseDir}/missing.txt`);
    expect(exists).toBe(false);
  });

  test("makeDir reports whether it created the directory", async () => {
    const path = `${baseDir}/dirs/root`;
    expect(await files.makeDir(path)).toBe(true);
    expect(await files.makeDir(path)).toBe(false);
  });

  test("getInfo returns rich metadata for files", async () => {
    const path = `${baseDir}/info/hello.txt`;
    await files.writeText(path, "hello from sdk files");

    const info = await files.getInfo(path);
    expect(info.name).toBe("hello.txt");
    expect(info.path).toBe(path);
    expect(info.type).toBe("file");
    expect(info.size).toBe("hello from sdk files".length);
    expect(info.mode).toBe(0o644);
    expect(info.permissions).toBe("-rw-r--r--");
    expect(info.owner.length).toBeGreaterThan(0);
    expect(info.group.length).toBeGreaterThan(0);
    expect(info.modifiedTime).toBeInstanceOf(Date);
  });

  test("list honors depth and returns rich metadata", async () => {
    const dir = `${baseDir}/list`;
    await files.makeDir(`${dir}/nested/inner`);
    await files.writeText(`${dir}/root.txt`, "root");
    await files.writeText(`${dir}/nested/child.txt`, "child");
    await files.writeText(`${dir}/nested/inner/grandchild.txt`, "grandchild");

    const depthOne = await files.list(dir, { depth: 1 });
    expect(depthOne.map((entry) => entry.name)).toEqual(["nested", "root.txt"]);
    expect(depthOne.map((entry) => entry.type)).toEqual(["dir", "file"]);

    const depthTwo = await files.list(dir, { depth: 2 });
    expect(depthTwo.map((entry) => entry.path)).toEqual([
      `${dir}/nested`,
      `${dir}/nested/child.txt`,
      `${dir}/nested/inner`,
      `${dir}/root.txt`,
    ]);
  });

  test("list includes symlink metadata for entries", async () => {
    const dir = `${baseDir}/list-symlink`;
    const target = `${dir}/target.txt`;
    const link = `${dir}/link.txt`;
    await files.makeDir(dir);
    await files.writeText(target, "payload");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `ln -sfn \"${target}\" \"${link}\"`],
    });
    expect(result.exitCode).toBe(0);

    const entries = await files.list(dir, { depth: 1 });
    const linkEntry = entries.find((entry) => entry.path === link);
    expect(linkEntry).toBeDefined();
    expect(linkEntry!.symlinkTarget).toBe(target);
  });

  test("getInfo surfaces symlink metadata", async () => {
    const target = `${baseDir}/symlink/target.txt`;
    const link = `${baseDir}/symlink/link.txt`;
    await files.writeText(target, "target");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `mkdir -p \"${baseDir}/symlink\" && ln -sfn \"${target}\" \"${link}\"`],
    });
    expect(result.exitCode).toBe(0);

    const info = await files.getInfo(link);
    expect(info.path).toBe(link);
    expect(info.symlinkTarget).toBe(target);
  });

  test("getInfo and exists work for broken symlinks", async () => {
    const brokenTarget = `${baseDir}/symlink-broken/missing-target.txt`;
    const brokenLink = `${baseDir}/symlink-broken/link.txt`;
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `mkdir -p \"${baseDir}/symlink-broken\" && ln -sfn \"${brokenTarget}\" \"${brokenLink}\"`,
      ],
    });
    expect(result.exitCode).toBe(0);

    expect(await files.exists(brokenLink)).toBe(true);
    const info = await files.getInfo(brokenLink);
    expect(info.path).toBe(brokenLink);
    expect(info.symlinkTarget).toBe(brokenTarget);
  });

  test("read supports text, bytes, blob, stream, offset, and length", async () => {
    const path = `${baseDir}/read/readme.txt`;
    await files.writeText(path, "hello from sdk files");

    const text = await files.read(path);
    expect(text).toBe("hello from sdk files");

    const chunk = await files.read(path, {
      format: "text",
      offset: 6,
      length: 4,
    });
    expect(chunk).toBe("from");

    const bytes = await files.read(path, { format: "bytes" });
    expect(bytes.equals(Buffer.from("hello from sdk files"))).toBe(true);

    const blob = await files.read(path, { format: "blob" });
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("hello from sdk files");

    const stream = await files.read(path, { format: "stream" });
    expect(await readStreamText(stream)).toBe("hello from sdk files");
  });

  test("write supports single files and batches", async () => {
    const single = await files.write(
      `${baseDir}/write/single.txt`,
      "single file"
    );
    expect(single.name).toBe("single.txt");
    expect(single.path).toBe(`${baseDir}/write/single.txt`);
    expect(await files.readText(single.path)).toBe("single file");

    const batch = await files.write([
      { path: `${baseDir}/write/batch-a.txt`, data: "batch-a" },
      { path: `${baseDir}/write/batch-b.bin`, data: Buffer.from([1, 2, 3, 4]) },
    ]);
    expect(batch).toHaveLength(2);
    expect(batch.map((entry) => entry.name)).toEqual(["batch-a.txt", "batch-b.bin"]);
    expect(await files.readText(`${baseDir}/write/batch-a.txt`)).toBe("batch-a");
    expect(
      (await files.readBytes(`${baseDir}/write/batch-b.bin`)).equals(
        Buffer.from([1, 2, 3, 4])
      )
    ).toBe(true);
  });

  test("writeText and writeBytes preserve append and mode options", async () => {
    const textPath = `${baseDir}/write-options/text.txt`;
    await files.writeText(textPath, "hello", { mode: "0640" });
    await files.writeText(textPath, " world", { append: true });
    expect(await files.readText(textPath)).toBe("hello world");
    expect((await files.getInfo(textPath)).mode).toBe(0o640);

    const bytesPath = `${baseDir}/write-options/bytes.bin`;
    await files.writeBytes(bytesPath, Buffer.from([1, 2]), { mode: "0600" });
    await files.writeBytes(bytesPath, Buffer.from([3]), { append: true });
    expect(
      (await files.readBytes(bytesPath)).equals(Buffer.from([1, 2, 3]))
    ).toBe(true);
  });

  test("upload and download transfer raw bytes", async () => {
    const path = `${baseDir}/transfer/upload.txt`;
    const uploaded = await files.upload(path, "uploaded from sdk");
    expect(uploaded.bytesWritten).toBeGreaterThan(0);

    const downloaded = await files.download(path);
    expect(downloaded.toString("utf8")).toBe("uploaded from sdk");
  });

  test("rename and copy preserve file and symlink semantics", async () => {
    const filePath = `${baseDir}/rename/hello.txt`;
    const renamedPath = `${baseDir}/rename/hello-renamed.txt`;
    await files.writeText(filePath, "rename me");

    const renamed = await files.rename(filePath, renamedPath);
    expect(renamed.path).toBe(renamedPath);
    expect(await files.exists(filePath)).toBe(false);
    expect(await files.readText(renamedPath)).toBe("rename me");

    const linkPath = `${baseDir}/rename/hello-link.txt`;
    const copiedLinkPath = `${baseDir}/rename/hello-link-copy.txt`;
    const renamedLinkPath = `${baseDir}/rename/hello-link-renamed.txt`;
    const linkResult = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `ln -sfn \"${renamedPath}\" \"${linkPath}\"`],
    });
    expect(linkResult.exitCode).toBe(0);

    const copiedLink = await files.copy({
      source: linkPath,
      destination: copiedLinkPath,
    });
    expect(copiedLink.path).toBe(copiedLinkPath);
    expect((await files.getInfo(copiedLinkPath)).symlinkTarget).toBe(renamedPath);

    const renamedLink = await files.rename(copiedLinkPath, renamedLinkPath);
    expect(renamedLink.path).toBe(renamedLinkPath);
    expect((await files.getInfo(renamedLinkPath)).symlinkTarget).toBe(renamedPath);
  });

  test("rename preserves symlinked directories and list follows the renamed link", async () => {
    const targetDir = `${baseDir}/rename-dir/target-dir`;
    const linkDir = `${baseDir}/rename-dir/link-dir`;
    const renamedLinkDir = `${baseDir}/rename-dir/link-dir-renamed`;
    await files.makeDir(targetDir);
    await files.writeText(`${targetDir}/child.txt`, "child");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `ln -sfn \"${targetDir}\" \"${linkDir}\"`],
    });
    expect(result.exitCode).toBe(0);

    const renamed = await files.rename(linkDir, renamedLinkDir);
    expect(renamed.path).toBe(renamedLinkDir);
    const info = await files.getInfo(renamedLinkDir);
    expect(info.symlinkTarget).toBe(targetDir);

    const entries = await files.list(renamedLinkDir, { depth: 1 });
    expect(entries.map((entry) => entry.path)).toEqual([`${targetDir}/child.txt`]);
  });

  test("copy preserves nested symlinks during recursive directory copy", async () => {
    const sourceDir = `${baseDir}/copy-tree/source`;
    const nestedDir = `${sourceDir}/nested`;
    const target = `${nestedDir}/target.txt`;
    const link = `${nestedDir}/link.txt`;
    const destinationDir = `${baseDir}/copy-tree/destination`;
    await files.makeDir(nestedDir);
    await files.writeText(target, "payload");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `cd \"${nestedDir}\" && ln -sfn \"target.txt\" \"link.txt\"`],
    });
    expect(result.exitCode).toBe(0);

    await files.copy({
      source: sourceDir,
      destination: destinationDir,
      recursive: true,
    });

    const copiedLink = `${destinationDir}/nested/link.txt`;
    const copiedTarget = `${destinationDir}/nested/target.txt`;
    expect(await files.readText(copiedTarget)).toBe("payload");
    expect((await files.getInfo(copiedLink)).symlinkTarget).toBe(copiedTarget);
  });

  test("list depth does not recurse through symlink loops", async () => {
    const dir = `${baseDir}/loop-list`;
    const nestedDir = `${dir}/nested`;
    const filePath = `${nestedDir}/child.txt`;
    await files.makeDir(nestedDir);
    await files.writeText(filePath, "payload");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `cd \"${nestedDir}\" && ln -sfn .. loop`],
    });
    expect(result.exitCode).toBe(0);

    const entries = await files.list(dir, { depth: 4 });
    const paths = entries.map((entry) => entry.path);
    expect(paths).toContain(`${nestedDir}/loop`);
    expect(paths.some((path) => path.includes("/loop/"))).toBe(false);
    expect((await files.getInfo(`${nestedDir}/loop`)).symlinkTarget).toBe(dir);
  });

  test("copy preserves symlink loops without expanding them", async () => {
    const sourceDir = `${baseDir}/loop-copy/source`;
    const nestedDir = `${sourceDir}/nested`;
    await files.makeDir(nestedDir);
    await files.writeText(`${nestedDir}/child.txt`, "payload");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `cd \"${nestedDir}\" && ln -sfn .. loop`],
    });
    expect(result.exitCode).toBe(0);

    const destinationDir = `${baseDir}/loop-copy/destination`;
    await files.copy({
      source: sourceDir,
      destination: destinationDir,
      recursive: true,
    });

    const copiedLoop = `${destinationDir}/nested/loop`;
    expect((await files.getInfo(copiedLoop)).symlinkTarget).toBe(
      `${destinationDir}`
    );

    const entries = await files.list(destinationDir, { depth: 4 });
    expect(entries.some((entry) => entry.path.includes("/loop/"))).toBe(false);
  });

  test("copy overwrite removes a symlink destination without touching its target", async () => {
    const source = `${baseDir}/copy-overwrite/source.txt`;
    const existingTarget = `${baseDir}/copy-overwrite/existing-target.txt`;
    const destinationLink = `${baseDir}/copy-overwrite/destination-link.txt`;
    await files.writeText(source, "source payload");
    await files.writeText(existingTarget, "existing target");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `mkdir -p \"${baseDir}/copy-overwrite\" && ln -sfn \"${existingTarget}\" \"${destinationLink}\"`,
      ],
    });
    expect(result.exitCode).toBe(0);

    await files.copy({
      source,
      destination: destinationLink,
      overwrite: true,
    });

    expect(await files.readText(destinationLink)).toBe("source payload");
    expect(await files.readText(existingTarget)).toBe("existing target");
    expect((await files.getInfo(destinationLink)).symlinkTarget).toBeUndefined();
  });

  test("chmod updates metadata and chown failures stay structured", async () => {
    const path = `${baseDir}/chmod/file.txt`;
    await files.writeText(path, "chmod me");

    await files.chmod({
      path,
      mode: "0640",
    });
    expect((await files.getInfo(path)).mode).toBe(0o640);

    await expectHyperbrowserError(
      "file chown",
      () =>
        files.chown({
          path,
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
        expect((await files.getInfo(path)).name).toBe("file.txt");
        return;
      }
      throw error;
    });
  });

  test("remove deletes paths and is idempotent for missing targets", async () => {
    const path = `${baseDir}/remove/file.txt`;
    await files.writeText(path, "remove me");

    await files.remove(path);
    expect(await files.exists(path)).toBe(false);

    await files.remove(path);
    await files.remove(`${baseDir}/remove`, { recursive: true });
    expect(await files.exists(`${baseDir}/remove`)).toBe(false);
  });

  test("remove unlinks symlinks without deleting their targets", async () => {
    const target = `${baseDir}/remove-link/target.txt`;
    const link = `${baseDir}/remove-link/link.txt`;
    await files.writeText(target, "keep me");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: ["-lc", `mkdir -p \"${baseDir}/remove-link\" && ln -sfn \"${target}\" \"${link}\"`],
    });
    expect(result.exitCode).toBe(0);

    await files.remove(link);
    expect(await files.exists(link)).toBe(false);
    expect(await files.readText(target)).toBe("keep me");
  });

  test("remove with recursive unlinks symlinked directories without deleting the target tree", async () => {
    const targetDir = `${baseDir}/remove-recursive/target-dir`;
    const targetFile = `${targetDir}/child.txt`;
    const linkDir = `${baseDir}/remove-recursive/link-dir`;
    await files.makeDir(targetDir);
    await files.writeText(targetFile, "keep tree");
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `mkdir -p \"${baseDir}/remove-recursive\" && ln -sfn \"${targetDir}\" \"${linkDir}\"`,
      ],
    });
    expect(result.exitCode).toBe(0);

    await files.remove(linkDir, { recursive: true });
    expect(await files.exists(linkDir)).toBe(false);
    expect(await files.readText(targetFile)).toBe("keep tree");
  });

  test("read and download follow symlinks whose targets resolve outside the old roots", async () => {
    const link = `${baseDir}/escape/file-link`;
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `mkdir -p \"${baseDir}/escape\" && ln -sfn /etc/hosts \"${link}\"`,
      ],
    });
    expect(result.exitCode).toBe(0);

    const text = await files.readText(link);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("localhost");

    const downloaded = await files.download(link);
    expect(downloaded.toString("utf8")).toContain("localhost");
  });

  test("read, download, list, and watchDir follow parent symlink targets", async () => {
    const { escapedFile, linkDir, outsideDir } = await createParentSymlinkEscapeFixture(
      sandbox!,
      baseDir,
      "parent-escape-read"
    );

    expect(await files.readText(escapedFile)).toBe("outside secret");
    expect((await files.download(escapedFile)).toString("utf8")).toBe(
      "outside secret"
    );

    const entries = await files.list(linkDir, { depth: 1 });
    expect(entries.map((entry) => entry.path)).toEqual([`${outsideDir}/secret.txt`]);

    const seen = waitForEvent<string>();
    const handle = await files.watchDir(
      linkDir,
      async (event) => {
        if (isCreateOrWriteEvent(event.type) && event.name === "fresh.txt") {
          seen.resolve(event.name);
        }
      },
      {
        onExit: rejectOnUnexpectedWatchExit(seen, "parent symlink"),
        timeoutMs: WATCH_TIMEOUT_MS,
      }
    );

    try {
      await files.writeText(`${outsideDir}/fresh.txt`, "watch parent link");
      await expect(seen.promise).resolves.toBe("fresh.txt");
    } finally {
      await handle.stop();
    }
  });

  test("getInfo, copy, rename, and remove follow parent symlink targets", async () => {
    const { escapedFile, outsideFile } = await createParentSymlinkEscapeFixture(
      sandbox!,
      baseDir,
      "parent-escape-mutate"
    );
    const copyDestination = `${baseDir}/parent-escape-mutate/copied.txt`;
    const renameDestination = `${baseDir}/parent-escape-mutate/renamed.txt`;

    const info = await files.getInfo(escapedFile);
    expect(info.type).toBe("file");
    expect(info.size).toBe("outside secret".length);

    const copied = await files.copy({
      source: escapedFile,
      destination: copyDestination,
    });
    expect(copied.path).toBe(copyDestination);
    expect(await files.readText(copyDestination)).toBe("outside secret");

    const renamed = await files.rename(escapedFile, renameDestination);
    expect(renamed.path).toBe(renameDestination);
    expect(await files.exists(outsideFile)).toBe(false);
    expect(await files.readText(renameDestination)).toBe("outside secret");

    await files.writeText(escapedFile, "remove me");
    await files.remove(escapedFile);

    const outsideRead = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `if [ -e "${outsideFile}" ]; then cat "${outsideFile}"; else printf '__MISSING__'; fi`,
      ],
    });
    expect(outsideRead.exitCode).toBe(0);
    expect(outsideRead.stdout.trim()).toBe("__MISSING__");
    expect(await files.exists(copyDestination)).toBe(true);
    expect(await files.exists(renameDestination)).toBe(true);
  });

  test("list and watchDir follow symlinked directories outside the old roots", async () => {
    const targetDir = `/var/tmp/${testName("watch-outside-target")}`;
    const targetFile = `${targetDir}/child.txt`;
    const link = `${baseDir}/escape/dir-link`;
    const result = await sandbox!.exec({
      runAs: "root",
      command: "bash",
      args: [
        "-lc",
        `mkdir -p \"${baseDir}/escape\" \"${targetDir}\" && printf 'child' > \"${targetFile}\" && ln -sfn \"${targetDir}\" \"${link}\"`,
      ],
    });
    expect(result.exitCode).toBe(0);

    const entries = await files.list(link, { depth: 1 });
    expect(entries.map((entry) => entry.path)).toEqual([targetFile]);

    const seen = waitForEvent<string>();
    const handle = await files.watchDir(
      link,
      async (event) => {
        if (isCreateOrWriteEvent(event.type) && event.name === "file.txt") {
          seen.resolve(event.name);
        }
      },
      {
        onExit: rejectOnUnexpectedWatchExit(seen, "symlinked directory"),
        timeoutMs: WATCH_TIMEOUT_MS,
      }
    );

    try {
      await files.writeText(`${targetDir}/file.txt`, "watch through link");
      await expect(seen.promise).resolves.toBe("file.txt");
    } finally {
      await handle.stop();
    }
  });

  test("watchDir reports relative file events and recursive nested changes", async () => {
    const dir = `${baseDir}/watch`;
    await files.makeDir(`${dir}/nested`);

    const directEvent = waitForEvent<string>();
    const recursiveEvent = waitForEvent<string>();

    const directHandle = await files.watchDir(
      dir,
      async (event) => {
        if (isCreateOrWriteEvent(event.type) && event.name === "direct.txt") {
          directEvent.resolve(event.name);
        }
      },
      {
        onExit: rejectOnUnexpectedWatchExit(directEvent, "direct watch"),
        timeoutMs: WATCH_TIMEOUT_MS,
      }
    );

    const recursiveHandle = await files.watchDir(
      dir,
      async (event) => {
        if (isCreateOrWriteEvent(event.type) && event.name === "nested/recursive.txt") {
          recursiveEvent.resolve(event.name);
        }
      },
      {
        recursive: true,
        onExit: rejectOnUnexpectedWatchExit(recursiveEvent, "recursive watch"),
        timeoutMs: WATCH_TIMEOUT_MS,
      }
    );

    try {
      await files.writeText(`${dir}/direct.txt`, "watch me");
      await files.writeText(`${dir}/nested/recursive.txt`, "watch me too");
      await expect(directEvent.promise).resolves.toBe("direct.txt");
      await expect(recursiveEvent.promise).resolves.toBe("nested/recursive.txt");
    } finally {
      await directHandle.stop();
      await recursiveHandle.stop();
    }
  });

  test("watchDir returns structured errors for missing directories and file paths", async () => {
    await expectHyperbrowserError(
      "watch missing directory",
      () => files.watchDir(`${baseDir}/watch-missing`, () => undefined),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["not found", "no such file"],
      }
    );

    const filePath = `${baseDir}/watch-invalid/file.txt`;
    await files.writeText(filePath, "not a directory");
    await expectHyperbrowserError(
      "watch file path",
      () => files.watchDir(filePath, () => undefined),
      {
        statusCode: 400,
        service: "runtime",
        retryable: false,
        messageIncludes: "not a directory",
      }
    );
  });

  test("presigned upload and download URLs work end to end", async () => {
    const path = `${baseDir}/presign/file.txt`;
    const upload = await files.uploadUrl(path, {
      oneTime: true,
    });
    expect(upload.path).toBe(path);
    expect(upload.method).toBe("PUT");

    const uploadResponse = await fetchSignedUrl(upload.url, {
      method: upload.method,
      body: "presigned upload body",
    });
    expect(uploadResponse.status).toBe(200);
    expect(await files.readText(path)).toBe("presigned upload body");

    const download = await files.downloadUrl(path, {
      oneTime: true,
    });
    expect(download.path).toBe(path);
    expect(download.method).toBe("GET");

    const downloadResponse = await fetchSignedUrl(download.url, {
      method: download.method,
    });
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe("presigned upload body");
  });

  test("one-time presigned upload URLs allow only one concurrent use", async () => {
    const path = `${baseDir}/presign-race/upload.txt`;
    const upload = await files.uploadUrl(path, { oneTime: true });

    const [first, second] = await Promise.all([
      fetchSignedUrl(upload.url, {
        method: upload.method,
        body: "first body",
      }),
      fetchSignedUrl(upload.url, {
        method: upload.method,
        body: "second body",
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);

    const finalContent = await files.readText(path);
    expect(["first body", "second body"]).toContain(finalContent);
  });

  test("one-time presigned download URLs allow only one concurrent use", async () => {
    const path = `${baseDir}/presign-race/download.txt`;
    await files.writeText(path, "download once");
    const download = await files.downloadUrl(path, { oneTime: true });

    const [first, second] = await Promise.all([
      fetchSignedUrl(download.url, {
        method: download.method,
      }),
      fetchSignedUrl(download.url, {
        method: download.method,
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);
    const bodies = await Promise.all([first.text(), second.text()]);
    expect(bodies).toContain("download once");
  });

  test("concurrent renames on the same source return one success and one structured failure", async () => {
    const source = `${baseDir}/rename-race/source.txt`;
    const left = `${baseDir}/rename-race/left.txt`;
    const right = `${baseDir}/rename-race/right.txt`;
    await files.writeText(source, "race");

    const results = await Promise.allSettled([
      files.rename(source, left),
      files.rename(source, right),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = await expectHyperbrowserError(
      "rename race failure",
      async () => {
        throw (rejected[0] as PromiseRejectedResult).reason;
      },
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["not found", "no such file"],
      }
    );
    expect(error).toBeDefined();

    const winnerPath = await files.exists(left) ? left : right;
    expect(await files.readText(winnerPath)).toBe("race");
  });

  test("missing file reads still return structured errors", async () => {
    await expectHyperbrowserError(
      "missing file read",
      () => files.readText(`${baseDir}/still-missing.txt`),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludesAny: ["not found", "no such file"],
      }
    );
  });

  test("list rejects invalid depth locally", async () => {
    await expect(files.list(baseDir, { depth: 0 })).rejects.toThrow(
      "depth should be at least one"
    );
  });
});
