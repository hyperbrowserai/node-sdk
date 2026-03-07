import type { Blob } from "buffer";
import type { ReadableStream } from "node:stream/web";
import { SessionRegion } from "./constants";
import { SessionLaunchState, SessionStatus } from "./session";

export type SandboxStatus = SessionStatus;

export interface SandboxRuntimeTarget {
  transport: "regional_proxy";
  host: string;
  baseUrl: string;
}

export interface Sandbox {
  id: string;
  teamId: string;
  status: SandboxStatus;
  endTime?: number | null;
  startTime?: number | null;
  createdAt: string;
  updatedAt: string;
  closeReason?: string | null;
  dataConsumed?: number;
  proxyDataConsumed?: number;
  usageType?: string;
  jobId?: string | null;
  launchState?: SessionLaunchState | null;
  creditsUsed: number | null;
  region: SessionRegion;
  sessionUrl: string;
  duration: number;
  proxyBytesUsed: number;
  runtime: SandboxRuntimeTarget;
}

export interface SandboxDetail extends Sandbox {
  token: string | null;
  tokenExpiresAt: string | null;
}

export interface SandboxRuntimeSession {
  sandboxId: string;
  status: SandboxStatus;
  region: SessionRegion;
  token: string;
  tokenExpiresAt: string | null;
  runtime: SandboxRuntimeTarget;
}

export type SandboxSnapshotSelector =
  | {
      snapshotId: string;
      snapshotName?: never;
      snapshotNamespace?: never;
    }
  | {
      snapshotId?: never;
      snapshotName: string;
      snapshotNamespace?: string;
    };

export type CreateSandboxParams = {
  sandboxName: string;
  region?: SessionRegion;
  enableRecording?: boolean;
  timeoutMinutes?: number;
} & SandboxSnapshotSelector;

export type StartSandboxFromSnapshotParams = CreateSandboxParams;

export interface SandboxListParams {
  status?: SandboxStatus;
  page?: number;
  limit?: number;
  search?: string;
}

export interface SandboxListResponse {
  sandboxes: Sandbox[];
  totalCount: number;
  page: number;
  perPage: number;
}

export type SandboxProcessStatus =
  | "queued"
  | "running"
  | "exited"
  | "failed"
  | "killed"
  | "timed_out";

export interface SandboxExecParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  timeoutSec?: number;
  useShell?: boolean;
}

export interface SandboxProcessSummary {
  id: string;
  status: SandboxProcessStatus;
  command: string;
  args?: string[];
  cwd: string;
  pid?: number;
  exitCode?: number | null;
  startedAt: number;
  completedAt?: number;
}

export interface SandboxProcessResult {
  id: string;
  status: SandboxProcessStatus;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface SandboxProcessListParams {
  status?: SandboxProcessStatus | SandboxProcessStatus[];
  limit?: number;
  cursor?: string | number;
  createdAfter?: number;
  createdBefore?: number;
}

export interface SandboxProcessListResponse {
  data: SandboxProcessSummary[];
  nextCursor?: string;
}

export interface SandboxProcessWaitParams {
  timeoutMs?: number;
  timeoutSec?: number;
}

export type SandboxProcessSignal =
  | "TERM"
  | "KILL"
  | "INT"
  | "HUP"
  | "QUIT"
  | string;

export interface SandboxProcessStdinParams {
  data?: string | Uint8Array;
  encoding?: "utf8" | "base64";
  eof?: boolean;
}

export type SandboxProcessStreamEvent =
  | {
      type: "stdout" | "stderr" | "system";
      seq: number;
      data: string;
      timestamp: number;
    }
  | {
      type: "exit";
      result: SandboxProcessResult;
    };

export type SandboxFileType = "file" | "dir";

export interface SandboxFileInfo {
  path: string;
  name: string;
  type: SandboxFileType;
  size: number;
  mode: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedTime?: Date;
  symlinkTarget?: string;
}

export interface SandboxFileWriteInfo {
  path: string;
  name: string;
  type?: SandboxFileType;
}

export interface SandboxFileListOptions {
  depth?: number;
}

export type SandboxFileReadFormat = "text" | "bytes" | "blob" | "stream";

export interface SandboxFileReadOptions {
  offset?: number;
  length?: number;
  format?: SandboxFileReadFormat;
}

export type SandboxFileWriteData =
  | string
  | Uint8Array
  | Buffer
  | ArrayBuffer
  | Blob
  | ReadableStream<Uint8Array>;

export interface SandboxFileWriteEntry {
  path: string;
  data: SandboxFileWriteData;
}

export interface SandboxFileTextWriteOptions {
  append?: boolean;
  mode?: string;
}

export interface SandboxFileBytesWriteOptions {
  append?: boolean;
  mode?: string;
}

export interface SandboxFileRemoveOptions {
  recursive?: boolean;
}

export interface SandboxFileMakeDirOptions {
  parents?: boolean;
  mode?: string;
}

export interface SandboxFileTransferResult {
  path: string;
  bytesWritten: number;
}

export interface SandboxFileCopyParams {
  source: string;
  destination: string;
  recursive?: boolean;
  overwrite?: boolean;
}

export interface SandboxFileChmodParams {
  path: string;
  mode: string;
  recursive?: boolean;
}

export interface SandboxFileChownParams {
  path: string;
  uid?: number;
  gid?: number;
  recursive?: boolean;
}

export type SandboxFileSystemEventType =
  | "chmod"
  | "create"
  | "remove"
  | "rename"
  | "write";

export interface SandboxFileSystemEvent {
  name: string;
  type: SandboxFileSystemEventType;
}

export interface SandboxWatchDirOptions {
  recursive?: boolean;
  timeoutMs?: number;
  onExit?: (error?: Error) => void | Promise<void>;
}

export interface SandboxPresignFileParams {
  path: string;
  expiresInSeconds?: number;
  oneTime?: boolean;
}

export interface SandboxPresignedUrl {
  token: string;
  path: string;
  method: string;
  expiresAt: number;
  url: string;
}

export interface SandboxTerminalCreateParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  useShell?: boolean;
  rows?: number;
  cols?: number;
  timeoutMs?: number;
}

export interface SandboxTerminalStatus {
  id: string;
  command: string;
  args?: string[];
  cwd: string;
  pid?: number;
  running: boolean;
  exitCode?: number | null;
  error?: string;
  timedOut?: boolean;
  rows: number;
  cols: number;
  startedAt: number;
  finishedAt?: number;
}

export interface SandboxTerminalWaitParams {
  timeoutMs?: number;
  includeOutput?: boolean;
}

export interface SandboxTerminalKillParams {
  signal?: string;
  timeoutMs?: number;
}

export type SandboxTerminalEvent =
  | {
      type: "output";
      seq: number;
      data: string;
      raw: Buffer;
      timestamp: number;
    }
  | {
      type: "exit";
      status: SandboxTerminalStatus;
    };
