import { Blob, Buffer } from "buffer";
import nodePath from "path";
import { ReadableStream } from "node:stream/web";
import WebSocket from "ws";
import { HyperbrowserError } from "../client";
import { RuntimeTransport } from "./base";
import { AsyncEventQueue, openRuntimeWebSocket, toWebSocketUrl } from "./ws";
import {
  SandboxFileChmodParams,
  SandboxFileChownParams,
  SandboxFileCopyParams,
  SandboxFileInfo,
  SandboxFileListOptions,
  SandboxFileMakeDirOptions,
  SandboxFileReadOptions,
  SandboxFileSystemEvent,
  SandboxFileSystemEventType,
  SandboxFileTransferResult,
  SandboxFileType,
  SandboxFileWriteData,
  SandboxFileWriteEntry,
  SandboxFileWriteInfo,
  SandboxFileBytesWriteOptions,
  SandboxFileTextWriteOptions,
  SandboxPresignFileParams,
  SandboxPresignedUrl,
  SandboxWatchDirOptions,
} from "../types/sandbox";

interface RawSandboxFileInfo {
  path: string;
  name: string;
  type: string;
  size: number;
  mode: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedTime?: number;
  symlinkTarget?: string;
}

interface RawSandboxFileWriteInfo {
  path: string;
  name: string;
  type?: string;
}

interface FileListWireResponse {
  path: string;
  depth: number;
  entries: RawSandboxFileInfo[];
}

interface FileStatWireResponse {
  file: RawSandboxFileInfo;
}

interface FileReadWireResponse {
  content: string;
  encoding: "utf8" | "base64";
  bytesRead: number;
  truncated: boolean;
  contentType?: string;
}

interface FileWriteWireResponse {
  files: RawSandboxFileWriteInfo[];
}

interface FileMutationWireResponse {
  path: string;
  created?: boolean;
}

interface FileMoveCopyWireResponse {
  entry: RawSandboxFileInfo;
}

interface FileWatchStatusResponse {
  watch: RawFileWatchStatus;
}

interface RawFileWatchEvent {
  seq: number;
  path: string;
  op: string;
  timestamp: number;
}

interface RawFileWatchStatus {
  id: string;
  path: string;
  recursive: boolean;
  active: boolean;
  error?: string;
  createdAt: number;
  stoppedAt?: number;
  oldestSeq?: number;
  lastSeq?: number;
  eventCount?: number;
}

interface RuntimeConnectionInfo {
  sandboxId: string;
  baseUrl: string;
  token: string;
}

const normalizeFileType = (value?: string): SandboxFileType | undefined => {
  if (!value) {
    return undefined;
  }
  return value === "dir" || value === "directory" ? "dir" : "file";
};

const normalizeFileInfo = (entry: RawSandboxFileInfo): SandboxFileInfo => ({
  path: entry.path,
  name: entry.name,
  type: normalizeFileType(entry.type) ?? "file",
  size: entry.size,
  mode: entry.mode,
  permissions: entry.permissions,
  owner: entry.owner,
  group: entry.group,
  modifiedTime:
    entry.modifiedTime === undefined ? undefined : new Date(entry.modifiedTime),
  symlinkTarget: entry.symlinkTarget,
});

const normalizeWriteInfo = (
  entry: RawSandboxFileWriteInfo
): SandboxFileWriteInfo => ({
  path: entry.path,
  name: entry.name,
  type: normalizeFileType(entry.type),
});

const normalizeEventType = (
  operation: string
): SandboxFileSystemEventType | null => {
  const lower = operation.toLowerCase();
  if (lower.includes("chmod")) {
    return "chmod";
  }
  if (lower.includes("create")) {
    return "create";
  }
  if (lower.includes("remove") || lower.includes("delete")) {
    return "remove";
  }
  if (lower.includes("rename")) {
    return "rename";
  }
  if (lower.includes("write")) {
    return "write";
  }
  return null;
};

const relativeWatchName = (root: string, absolutePath: string): string => {
  const relative = nodePath.relative(root, absolutePath);
  if (!relative || relative === ".") {
    return nodePath.basename(absolutePath);
  }
  return relative.split(nodePath.sep).join("/");
};

const isReadableStreamLike = (
  value: SandboxFileWriteData
): value is ReadableStream<Uint8Array> => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReadableStream<Uint8Array>).getReader === "function"
  );
};

const toReadableStream = (buffer: Buffer): ReadableStream<Uint8Array> => {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
};

const bufferFromReadableStream = async (
  stream: ReadableStream<Uint8Array>
): Promise<Buffer> => {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
};

const encodeWriteData = async (
  data: SandboxFileWriteData
): Promise<{ data: string; encoding: "utf8" | "base64" }> => {
  if (typeof data === "string") {
    return {
      data,
      encoding: "utf8",
    };
  }

  if (Buffer.isBuffer(data)) {
    return {
      data: data.toString("base64"),
      encoding: "base64",
    };
  }

  if (data instanceof Uint8Array) {
    return {
      data: Buffer.from(data).toString("base64"),
      encoding: "base64",
    };
  }

  if (data instanceof ArrayBuffer) {
    return {
      data: Buffer.from(data).toString("base64"),
      encoding: "base64",
    };
  }

  if (data instanceof Blob) {
    return {
      data: Buffer.from(await data.arrayBuffer()).toString("base64"),
      encoding: "base64",
    };
  }

  if (isReadableStreamLike(data)) {
    return {
      data: (await bufferFromReadableStream(data)).toString("base64"),
      encoding: "base64",
    };
  }

  throw new Error("Unsupported write data type");
};

class RuntimeFileWatchHandle {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>,
    private readonly status: RawFileWatchStatus,
    private readonly runtimeProxyOverride?: string
  ) {}

  get id(): string {
    return this.status.id;
  }

  get path(): string {
    return this.status.path;
  }

  async stop(): Promise<void> {
    await this.transport.requestJSON<{ success: boolean }>(
      `/sandbox/files/watch/${this.status.id}`,
      {
        method: "DELETE",
      }
    );
  }

  async *events(cursor?: number): AsyncGenerator<RawFileWatchEvent> {
    const connectionInfo = await this.getConnectionInfo();
    const target = toWebSocketUrl(
      connectionInfo.baseUrl,
      `/sandbox/files/watch/${this.status.id}/ws?sessionId=${encodeURIComponent(
        connectionInfo.sandboxId
      )}${cursor !== undefined ? `&cursor=${encodeURIComponent(String(cursor))}` : ""}`,
      this.runtimeProxyOverride
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${connectionInfo.token}`,
    };
    if (target.hostHeader) {
      headers.Host = target.hostHeader;
    }

    const ws = await openRuntimeWebSocket(target, headers);
    const queue = new AsyncEventQueue<RawFileWatchEvent>();

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as
          | { type: "event"; event: RawFileWatchEvent }
          | { type: "done"; status: RawFileWatchStatus }
          | { error: string; code?: string };

        if ("error" in parsed) {
          queue.fail(
            new HyperbrowserError(parsed.error, {
              statusCode: 410,
              code: parsed.code,
              retryable: false,
              service: "runtime",
            })
          );
          return;
        }

        if (parsed.type === "event") {
          queue.push(parsed.event);
          return;
        }

        queue.close();
      } catch (error) {
        queue.fail(error);
      }
    });

    ws.on("close", () => queue.close());
    ws.on("error", (error) => queue.fail(error));

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      if (
        ws.readyState !== WebSocket.CLOSING &&
        ws.readyState !== WebSocket.CLOSED
      ) {
        await new Promise<void>((resolve) => {
          ws.once("close", () => resolve());
          ws.close();
        });
      }
    }
  }
}

export class SandboxWatchDirHandle {
  private readonly runPromise: Promise<void>;
  private timeout?: NodeJS.Timeout;
  private stopRequested = false;
  private exitNotified = false;

  constructor(
    private readonly watch: RuntimeFileWatchHandle,
    onEvent: (event: SandboxFileSystemEvent) => void | Promise<void>,
    private readonly onExit?: (error?: Error) => void | Promise<void>,
    timeoutMs?: number
  ) {
    if (timeoutMs !== undefined && timeoutMs > 0) {
      this.timeout = setTimeout(() => {
        void this.stop();
      }, timeoutMs);
      this.timeout.unref?.();
    }
    this.runPromise = this.run(onEvent);
  }

  async stop(): Promise<void> {
    if (this.stopRequested) {
      return;
    }
    this.stopRequested = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    await this.watch.stop();
    await this.runPromise.catch(() => undefined);
  }

  private async run(
    onEvent: (event: SandboxFileSystemEvent) => void | Promise<void>
  ): Promise<void> {
    let exitError: Error | undefined;
    try {
      for await (const event of this.watch.events()) {
        const type = normalizeEventType(event.op);
        if (!type) {
          continue;
        }
        await onEvent({
          type,
          name: relativeWatchName(this.watch.path, event.path),
        });
      }
    } catch (error) {
      exitError = error as Error;
    } finally {
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      if (!this.exitNotified) {
        this.exitNotified = true;
        await this.onExit?.(exitError);
      }
    }
  }
}

export class SandboxFilesApi {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>,
    private readonly runtimeProxyOverride?: string
  ) {}

  async exists(path: string): Promise<boolean> {
    try {
      await this.getInfo(path);
      return true;
    } catch (error: unknown) {
      if (error instanceof HyperbrowserError && error.statusCode === 404) {
        return false;
      }
      if (
        error instanceof Error &&
        /not found|no such file|does not exist/i.test(error.message)
      ) {
        return false;
      }
      throw error;
    }
  }

  async getInfo(path: string): Promise<SandboxFileInfo> {
    const response = await this.transport.requestJSON<FileStatWireResponse>(
      "/sandbox/files/stat",
      undefined,
      { path }
    );
    return normalizeFileInfo(response.file);
  }

  async list(
    path: string,
    options: SandboxFileListOptions = {}
  ): Promise<SandboxFileInfo[]> {
    if (options.depth !== undefined && options.depth < 1) {
      throw new Error("depth should be at least one");
    }

    const response = await this.transport.requestJSON<FileListWireResponse>(
      "/sandbox/files",
      undefined,
      {
        path,
        depth: options.depth ?? 1,
      }
    );

    return response.entries.map(normalizeFileInfo);
  }

  async read(
    path: string,
    options?: SandboxFileReadOptions & { format?: "text" }
  ): Promise<string>;
  async read(
    path: string,
    options: SandboxFileReadOptions & { format: "bytes" }
  ): Promise<Buffer>;
  async read(
    path: string,
    options: SandboxFileReadOptions & { format: "blob" }
  ): Promise<Blob>;
  async read(
    path: string,
    options: SandboxFileReadOptions & { format: "stream" }
  ): Promise<ReadableStream<Uint8Array>>;
  async read(
    path: string,
    options: SandboxFileReadOptions = {}
  ): Promise<string | Buffer | Blob | ReadableStream<Uint8Array>> {
    const format = options.format ?? "text";
    if (format === "text") {
      const response = await this.readWire(path, options, "utf8");
      return response.content;
    }

    const response = await this.readWire(path, options, "base64");
    const bytes = Buffer.from(response.content, "base64");
    if (format === "bytes") {
      return bytes;
    }
    if (format === "blob") {
      return new Blob([bytes], {
        type: response.contentType || "application/octet-stream",
      });
    }
    return toReadableStream(bytes);
  }

  async readText(path: string, options: Omit<SandboxFileReadOptions, "format"> = {}): Promise<string> {
    return this.read(path, { ...options, format: "text" });
  }

  async readBytes(path: string, options: Omit<SandboxFileReadOptions, "format"> = {}): Promise<Buffer> {
    return this.read(path, { ...options, format: "bytes" });
  }

  async write(path: string, data: SandboxFileWriteData): Promise<SandboxFileWriteInfo>;
  async write(files: SandboxFileWriteEntry[]): Promise<SandboxFileWriteInfo[]>;
  async write(
    pathOrFiles: string | SandboxFileWriteEntry[],
    data?: SandboxFileWriteData
  ): Promise<SandboxFileWriteInfo | SandboxFileWriteInfo[]> {
    if (typeof pathOrFiles !== "string" && !Array.isArray(pathOrFiles)) {
      throw new Error("Path or files are required");
    }

    if (typeof pathOrFiles === "string" && data === undefined) {
      throw new Error("Path and data are required");
    }

    const files =
      typeof pathOrFiles === "string"
        ? [{ path: pathOrFiles, data: data as SandboxFileWriteData }]
        : pathOrFiles;

    if (files.length === 0) {
      return [];
    }

    const encodedFiles = await Promise.all(
      files.map(async (file) => {
        if (!file || typeof file.path !== "string" || file.path.length === 0) {
          throw new Error("Each write entry requires a path");
        }
        return {
          path: file.path,
          ...(await encodeWriteData(file.data)),
        };
      })
    );

    const response = await this.transport.requestJSON<FileWriteWireResponse>(
      "/sandbox/files/write",
      {
        method: "POST",
        body: JSON.stringify({ files: encodedFiles }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    const results = response.files.map(normalizeWriteInfo);
    return typeof pathOrFiles === "string" ? results[0]! : results;
  }

  async writeText(
    path: string,
    data: string,
    options: SandboxFileTextWriteOptions = {}
  ): Promise<SandboxFileWriteInfo> {
    return this.writeSingle(path, data, "utf8", options);
  }

  async writeBytes(
    path: string,
    data: Uint8Array,
    options: SandboxFileBytesWriteOptions = {}
  ): Promise<SandboxFileWriteInfo> {
    return this.writeSingle(
      path,
      Buffer.from(data).toString("base64"),
      "base64",
      options
    );
  }

  async upload(
    path: string,
    data: Buffer | Uint8Array | string
  ): Promise<SandboxFileTransferResult> {
    const body =
      typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);

    const response = await this.transport.requestJSON<{
      bytesWritten: number;
      path: string;
    }>(
      "/sandbox/files/upload",
      {
        method: "PUT",
        body,
      },
      { path }
    );

    return {
      path: response.path,
      bytesWritten: response.bytesWritten,
    };
  }

  async download(path: string): Promise<Buffer> {
    return this.transport.requestBuffer("/sandbox/files/download", undefined, {
      path,
    });
  }

  async makeDir(
    path: string,
    options: SandboxFileMakeDirOptions = {}
  ): Promise<boolean> {
    const response = await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/mkdir",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          parents: options.parents,
          mode: options.mode,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return Boolean(response.created);
  }

  async rename(oldPath: string, newPath: string): Promise<SandboxFileInfo> {
    const response = await this.transport.requestJSON<FileMoveCopyWireResponse>(
      "/sandbox/files/move",
      {
        method: "POST",
        body: JSON.stringify({
          from: oldPath,
          to: newPath,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return normalizeFileInfo(response.entry);
  }

  async remove(
    path: string,
    options: { recursive?: boolean } = {}
  ): Promise<void> {
    await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/delete",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          recursive: options.recursive,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  async copy(params: SandboxFileCopyParams): Promise<SandboxFileInfo> {
    const response = await this.transport.requestJSON<FileMoveCopyWireResponse>(
      "/sandbox/files/copy",
      {
        method: "POST",
        body: JSON.stringify({
          from: params.source,
          to: params.destination,
          recursive: params.recursive,
          overwrite: params.overwrite,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return normalizeFileInfo(response.entry);
  }

  async chmod(params: SandboxFileChmodParams): Promise<void> {
    await this.transport.requestJSON<{ success: boolean }>(
      "/sandbox/files/chmod",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  async chown(params: SandboxFileChownParams): Promise<void> {
    await this.transport.requestJSON<{ success: boolean }>(
      "/sandbox/files/chown",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  async watchDir(
    path: string,
    onEvent: (event: SandboxFileSystemEvent) => void | Promise<void>,
    options: SandboxWatchDirOptions = {}
  ): Promise<SandboxWatchDirHandle> {
    const response = await this.transport.requestJSON<FileWatchStatusResponse>(
      "/sandbox/files/watch",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          recursive: options.recursive,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    const watch = new RuntimeFileWatchHandle(
      this.transport,
      this.getConnectionInfo,
      response.watch,
      this.runtimeProxyOverride
    );

    return new SandboxWatchDirHandle(
      watch,
      onEvent,
      options.onExit,
      options.timeoutMs
    );
  }

  async uploadUrl(path: string, options: Omit<SandboxPresignFileParams, "path"> = {}): Promise<SandboxPresignedUrl> {
    return this.transport.requestJSON<SandboxPresignedUrl>(
      "/sandbox/files/presign-upload",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          expiresInSeconds: options.expiresInSeconds,
          oneTime: options.oneTime,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  async downloadUrl(path: string, options: Omit<SandboxPresignFileParams, "path"> = {}): Promise<SandboxPresignedUrl> {
    return this.transport.requestJSON<SandboxPresignedUrl>(
      "/sandbox/files/presign-download",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          expiresInSeconds: options.expiresInSeconds,
          oneTime: options.oneTime,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  private async readWire(
    path: string,
    options: Omit<SandboxFileReadOptions, "format">,
    encoding: "utf8" | "base64"
  ): Promise<FileReadWireResponse> {
    return this.transport.requestJSON<FileReadWireResponse>(
      "/sandbox/files/read",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          offset: options.offset,
          length: options.length,
          encoding,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  private async writeSingle(
    path: string,
    data: string,
    encoding: "utf8" | "base64",
    options: { append?: boolean; mode?: string }
  ): Promise<SandboxFileWriteInfo> {
    const response = await this.transport.requestJSON<FileWriteWireResponse>(
      "/sandbox/files/write",
      {
        method: "POST",
        body: JSON.stringify({
          path,
          data,
          encoding,
          append: options.append,
          mode: options.mode,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return normalizeWriteInfo(response.files[0]!);
  }
}
