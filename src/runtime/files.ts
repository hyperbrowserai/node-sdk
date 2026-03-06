import WebSocket from "ws";
import { HyperbrowserError } from "../client";
import { RuntimeTransport } from "./base";
import { AsyncEventQueue, toWebSocketUrl } from "./ws";
import {
  SandboxFileChmodParams,
  SandboxFileChownParams,
  SandboxFileCopyParams,
  SandboxFileDeleteParams,
  SandboxFileEntry,
  SandboxFileListParams,
  SandboxFileListResponse,
  SandboxFileMoveParams,
  SandboxFileMutationResult,
  SandboxFileMkdirParams,
  SandboxFileReadParams,
  SandboxFileReadResult,
  SandboxFileTransferResult,
  SandboxFileUploadParams,
  SandboxFileWatchEvent,
  SandboxFileWatchEventsParams,
  SandboxFileWatchParams,
  SandboxFileWatchStatus,
  SandboxFileWatchStreamEvent,
  SandboxFileWriteBytesParams,
  SandboxFileWriteResult,
  SandboxFileWriteTextParams,
  SandboxPresignFileParams,
  SandboxPresignedUrl,
} from "../types/sandbox";

interface FileListWireResponse extends SandboxFileListResponse {
  success?: boolean;
}

interface FileStatWireResponse {
  file: SandboxFileEntry;
}

interface FileReadWireResponse extends SandboxFileReadResult {
  success?: boolean;
}

interface FileWriteWireResponse extends SandboxFileWriteResult {
  success?: boolean;
}

interface FileMutationWireResponse {
  path: string;
}

interface FileMoveCopyWireResponse {
  from: string;
  to: string;
}

interface FileWatchStatusResponse {
  watch: RawFileWatchStatus;
}

interface RawFileWatchEvent extends SandboxFileWatchEvent {}

interface RawFileWatchStatus {
  id: string;
  path: string;
  recursive: boolean;
  active: boolean;
  error?: string;
  createdAt: number;
  stoppedAt?: number;
  lastSeq?: number;
  eventCount?: number;
  events?: RawFileWatchEvent[];
}

interface RuntimeConnectionInfo {
  sandboxId: string;
  baseUrl: string;
  token: string;
}

type SandboxFileListOptions = Omit<SandboxFileListParams, "path">;
type SandboxFileReadOptions = Omit<SandboxFileReadParams, "path">;
type SandboxFileWriteTextOptions = Omit<SandboxFileWriteTextParams, "path" | "data">;
type SandboxFileWriteBytesOptions = Omit<
  SandboxFileWriteBytesParams,
  "path" | "data"
>;
type SandboxFileDeleteOptions = Omit<SandboxFileDeleteParams, "path">;
type SandboxFileMkdirOptions = Omit<SandboxFileMkdirParams, "path">;
type SandboxFileWatchOptions = Omit<SandboxFileWatchParams, "path">;
type SandboxPresignFileOptions = Omit<SandboxPresignFileParams, "path">;

const resolvePathParam = <T extends { path: string }>(
  input: string | T,
  options?: Omit<T, "path">
): T => {
  if (typeof input === "string") {
    return {
      path: input,
      ...(options || {}),
    } as T;
  }

  return input;
};

const resolveWriteParam = <T extends { path: string; data: unknown }>(
  input: string | T,
  dataOrOptions: T["data"] | Omit<T, "path" | "data">,
  maybeOptions?: Omit<T, "path" | "data">
): T => {
  if (typeof input === "string") {
    return {
      path: input,
      data: dataOrOptions as T["data"],
      ...(maybeOptions || {}),
    } as T;
  }

  return input;
};

const normalizeFileWatchStatus = (
  watch: RawFileWatchStatus
): SandboxFileWatchStatus => ({
  id: watch.id,
  path: watch.path,
  recursive: watch.recursive,
  active: watch.active,
  error: watch.error,
  createdAt: watch.createdAt,
  stoppedAt: watch.stoppedAt,
  lastSeq: watch.lastSeq || 0,
  eventCount: watch.eventCount || 0,
  events: watch.events,
});

export class SandboxFileWatchHandle {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>,
    private status: SandboxFileWatchStatus
  ) {}

  get id(): string {
    return this.status.id;
  }

  get current(): SandboxFileWatchStatus {
    return { ...this.status };
  }

  toJSON(): SandboxFileWatchStatus {
    return { ...this.status };
  }

  async refresh(includeEvents: boolean = false): Promise<SandboxFileWatchHandle> {
    const response = await this.transport.requestJSON<FileWatchStatusResponse>(
      `/sandbox/files/watch/${this.id}`,
      undefined,
      includeEvents ? { includeEvents: true } : undefined
    );

    this.status = normalizeFileWatchStatus(response.watch);
    return this;
  }

  async stop(): Promise<void> {
    await this.transport.requestJSON<{ success: boolean }>(
      `/sandbox/files/watch/${this.id}`,
      {
        method: "DELETE",
      }
    );

    this.status = {
      ...this.status,
      active: false,
      stoppedAt: this.status.stoppedAt || Date.now(),
    };
  }

  async *events(
    params: SandboxFileWatchEventsParams = {}
  ): AsyncGenerator<SandboxFileWatchStreamEvent> {
    const connectionInfo = await this.getConnectionInfo();
    const route = params.route || "ws";
    const target = toWebSocketUrl(
      connectionInfo.baseUrl,
      `/sandbox/files/watch/${this.id}/${route}?sessionId=${encodeURIComponent(
        connectionInfo.sandboxId
      )}${params.cursor !== undefined ? `&cursor=${encodeURIComponent(String(params.cursor))}` : ""}`
    );

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${connectionInfo.token}`,
      };
      if (target.hostHeader) {
        headers.Host = target.hostHeader;
      }

      const socket = new WebSocket(target.url, {
        headers,
      });

      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });

    const queue = new AsyncEventQueue<SandboxFileWatchStreamEvent>();

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as
          | {
              type: "event";
              event: RawFileWatchEvent;
            }
          | {
              type: "done";
              status: RawFileWatchStatus;
            };

        if (parsed.type === "event") {
          queue.push({
            type: "event",
            event: parsed.event,
          });
          return;
        }

        this.status = normalizeFileWatchStatus(parsed.status);
        queue.push({
          type: "done",
          status: this.current,
        });
        queue.close();
      } catch (error) {
        queue.fail(error);
      }
    });

    ws.on("close", () => {
      queue.close();
    });

    ws.on("error", (error) => {
      queue.fail(error);
    });

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

export class SandboxFilesApi {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>
  ) {}

  async list(
    path: string,
    options?: SandboxFileListOptions
  ): Promise<SandboxFileListResponse>;
  async list(params: SandboxFileListParams): Promise<SandboxFileListResponse>;
  async list(
    input: string | SandboxFileListParams,
    options: SandboxFileListOptions = {}
  ): Promise<SandboxFileListResponse> {
    const params = resolvePathParam<SandboxFileListParams>(input, options);
    const response = await this.transport.requestJSON<FileListWireResponse>(
      "/sandbox/files",
      undefined,
      {
        path: params.path,
        recursive: params.recursive,
        limit: params.limit,
        cursor: params.cursor,
      }
    );

    return {
      path: response.path,
      entries: response.entries,
      limit: response.limit,
      cursor: response.cursor,
      recursive: response.recursive,
      nextCursor: response.nextCursor,
    };
  }

  async stat(path: string): Promise<SandboxFileEntry> {
    const response = await this.transport.requestJSON<FileStatWireResponse>(
      "/sandbox/files/stat",
      undefined,
      { path }
    );
    return response.file;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
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

  async read(
    path: string,
    options?: SandboxFileReadOptions & { encoding?: "utf8" | "base64" }
  ): Promise<SandboxFileReadResult>;
  async read(
    params: SandboxFileReadParams & { encoding?: "utf8" | "base64" }
  ): Promise<SandboxFileReadResult>;
  async read(
    input: string | (SandboxFileReadParams & { encoding?: "utf8" | "base64" }),
    options: SandboxFileReadOptions & { encoding?: "utf8" | "base64" } = {}
  ): Promise<SandboxFileReadResult> {
    const params = resolvePathParam<
      SandboxFileReadParams & { encoding?: "utf8" | "base64" }
    >(input, options);
    const response = await this.transport.requestJSON<FileReadWireResponse>(
      "/sandbox/files/read",
      {
        method: "POST",
        body: JSON.stringify({
          path: params.path,
          offset: params.offset,
          length: params.length,
          encoding: params.encoding || "utf8",
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      content: response.content,
      encoding: response.encoding,
      bytesRead: response.bytesRead,
      truncated: response.truncated,
      contentType: response.contentType,
    };
  }

  async readText(path: string, options?: SandboxFileReadOptions): Promise<string>;
  async readText(params: SandboxFileReadParams): Promise<string>;
  async readText(
    input: string | SandboxFileReadParams,
    options: SandboxFileReadOptions = {}
  ): Promise<string> {
    const params = resolvePathParam<SandboxFileReadParams>(input, options);
    const result = await this.read({ ...params, encoding: "utf8" });
    return result.content;
  }

  async readBytes(path: string, options?: SandboxFileReadOptions): Promise<Buffer>;
  async readBytes(params: SandboxFileReadParams): Promise<Buffer>;
  async readBytes(
    input: string | SandboxFileReadParams,
    options: SandboxFileReadOptions = {}
  ): Promise<Buffer> {
    const params = resolvePathParam<SandboxFileReadParams>(input, options);
    const result = await this.read({ ...params, encoding: "base64" });
    return Buffer.from(result.content, "base64");
  }

  async writeText(
    path: string,
    data: string,
    options?: SandboxFileWriteTextOptions
  ): Promise<SandboxFileWriteResult>;
  async writeText(
    params: SandboxFileWriteTextParams
  ): Promise<SandboxFileWriteResult>;
  async writeText(
    input: string | SandboxFileWriteTextParams,
    dataOrOptions?: string | SandboxFileWriteTextOptions,
    maybeOptions?: SandboxFileWriteTextOptions
  ): Promise<SandboxFileWriteResult> {
    const params = resolveWriteParam<SandboxFileWriteTextParams>(
      input,
      dataOrOptions as string | SandboxFileWriteTextOptions,
      maybeOptions
    );
    return this.write({
      path: params.path,
      data: params.data,
      append: params.append,
      mode: params.mode,
    });
  }

  async writeBytes(
    path: string,
    data: Uint8Array,
    options?: SandboxFileWriteBytesOptions
  ): Promise<SandboxFileWriteResult>;
  async writeBytes(
    params: SandboxFileWriteBytesParams
  ): Promise<SandboxFileWriteResult>;
  async writeBytes(
    input: string | SandboxFileWriteBytesParams,
    dataOrOptions?: Uint8Array | SandboxFileWriteBytesOptions,
    maybeOptions?: SandboxFileWriteBytesOptions
  ): Promise<SandboxFileWriteResult> {
    const params = resolveWriteParam<SandboxFileWriteBytesParams>(
      input,
      dataOrOptions as Uint8Array | SandboxFileWriteBytesOptions,
      maybeOptions
    );
    return this.write({
      path: params.path,
      data: Buffer.from(params.data).toString("base64"),
      append: params.append,
      mode: params.mode,
      encoding: "base64",
    });
  }

  async upload(
    path: string,
    data: Buffer | Uint8Array | string
  ): Promise<SandboxFileTransferResult>;
  async upload(
    params: SandboxFileUploadParams
  ): Promise<SandboxFileTransferResult>;
  async upload(
    input: string | SandboxFileUploadParams,
    data?: Buffer | Uint8Array | string
  ): Promise<SandboxFileTransferResult> {
    const params =
      typeof input === "string"
        ? {
            path: input,
            data: data as Buffer | Uint8Array | string,
          }
        : input;
    const body =
      typeof params.data === "string"
        ? Buffer.from(params.data, "utf8")
        : Buffer.from(params.data);

    const response = await this.transport.requestJSON<FileWriteWireResponse>(
      "/sandbox/files/upload",
      {
        method: "PUT",
        body,
      },
      {
        path: params.path,
      }
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

  async delete(
    path: string,
    options?: SandboxFileDeleteOptions
  ): Promise<SandboxFileMutationResult>;
  async delete(
    params: SandboxFileDeleteParams
  ): Promise<SandboxFileMutationResult>;
  async delete(
    input: string | SandboxFileDeleteParams,
    options: SandboxFileDeleteOptions = {}
  ): Promise<SandboxFileMutationResult> {
    const params = resolvePathParam<SandboxFileDeleteParams>(input, options);
    const response = await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/delete",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      path: response.path,
    };
  }

  async mkdir(
    path: string,
    options?: SandboxFileMkdirOptions
  ): Promise<SandboxFileMutationResult>;
  async mkdir(
    params: SandboxFileMkdirParams
  ): Promise<SandboxFileMutationResult>;
  async mkdir(
    input: string | SandboxFileMkdirParams,
    options: SandboxFileMkdirOptions = {}
  ): Promise<SandboxFileMutationResult> {
    const params = resolvePathParam<SandboxFileMkdirParams>(input, options);
    const response = await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/mkdir",
      {
        method: "POST",
        body: JSON.stringify({
          path: params.path,
          parents: params.parents,
          mode: params.mode,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      path: response.path,
    };
  }

  async move(params: SandboxFileMoveParams): Promise<{
    from: string;
    to: string;
  }> {
    const response = await this.transport.requestJSON<FileMoveCopyWireResponse>(
      "/sandbox/files/move",
      {
        method: "POST",
        body: JSON.stringify({
          from: params.source,
          to: params.destination,
          overwrite: params.overwrite,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      from: response.from,
      to: response.to,
    };
  }

  async copy(params: SandboxFileCopyParams): Promise<{
    from: string;
    to: string;
  }> {
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

    return {
      from: response.from,
      to: response.to,
    };
  }

  async chmod(
    params: SandboxFileChmodParams
  ): Promise<SandboxFileMutationResult> {
    const response = await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/chmod",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      path: response.path,
    };
  }

  async chown(
    params: SandboxFileChownParams
  ): Promise<SandboxFileMutationResult> {
    const response = await this.transport.requestJSON<FileMutationWireResponse>(
      "/sandbox/files/chown",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      path: response.path,
    };
  }

  async watch(
    path: string,
    options?: SandboxFileWatchOptions
  ): Promise<SandboxFileWatchHandle>;
  async watch(params: SandboxFileWatchParams): Promise<SandboxFileWatchHandle>;
  async watch(
    input: string | SandboxFileWatchParams,
    options: SandboxFileWatchOptions = {}
  ): Promise<SandboxFileWatchHandle> {
    const params = resolvePathParam<SandboxFileWatchParams>(input, options);
    const response = await this.transport.requestJSON<FileWatchStatusResponse>(
      "/sandbox/files/watch",
      {
        method: "POST",
        body: JSON.stringify({
          path: params.path,
          recursive: params.recursive,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return new SandboxFileWatchHandle(
      this.transport,
      this.getConnectionInfo,
      normalizeFileWatchStatus(response.watch)
    );
  }

  async getWatch(
    id: string,
    includeEvents: boolean = false
  ): Promise<SandboxFileWatchHandle> {
    const response = await this.transport.requestJSON<FileWatchStatusResponse>(
      `/sandbox/files/watch/${id}`,
      undefined,
      includeEvents ? { includeEvents: true } : undefined
    );

    return new SandboxFileWatchHandle(
      this.transport,
      this.getConnectionInfo,
      normalizeFileWatchStatus(response.watch)
    );
  }

  async uploadUrl(
    path: string,
    options?: SandboxPresignFileOptions
  ): Promise<SandboxPresignedUrl>;
  async uploadUrl(params: SandboxPresignFileParams): Promise<SandboxPresignedUrl>;
  async uploadUrl(
    input: string | SandboxPresignFileParams,
    options: SandboxPresignFileOptions = {}
  ): Promise<SandboxPresignedUrl> {
    const params = resolvePathParam<SandboxPresignFileParams>(input, options);
    return this.transport.requestJSON<SandboxPresignedUrl>(
      "/sandbox/files/presign-upload",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  async downloadUrl(
    path: string,
    options?: SandboxPresignFileOptions
  ): Promise<SandboxPresignedUrl>;
  async downloadUrl(
    params: SandboxPresignFileParams
  ): Promise<SandboxPresignedUrl>;
  async downloadUrl(
    input: string | SandboxPresignFileParams,
    options: SandboxPresignFileOptions = {}
  ): Promise<SandboxPresignedUrl> {
    const params = resolvePathParam<SandboxPresignFileParams>(input, options);
    return this.transport.requestJSON<SandboxPresignedUrl>(
      "/sandbox/files/presign-download",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  private async write(params: {
    path: string;
    data: string;
    append?: boolean;
    mode?: string;
    encoding?: "utf8" | "base64";
  }): Promise<SandboxFileWriteResult> {
    const response = await this.transport.requestJSON<FileWriteWireResponse>(
      "/sandbox/files/write",
      {
        method: "POST",
        body: JSON.stringify({
          path: params.path,
          data: params.data,
          append: params.append,
          mode: params.mode,
          encoding: params.encoding || "utf8",
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return {
      path: response.path,
      bytesWritten: response.bytesWritten,
    };
  }
}
