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
  exposedPorts: SandboxExposeResult[];
}

export interface SandboxDetail extends Sandbox {
  token: string | null;
  tokenExpiresAt: string | null;
}

interface SandboxCreateCommonParams {
  region?: SessionRegion;
  enableRecording?: boolean;
  exposedPorts?: SandboxExposeParams[];
  timeoutMinutes?: number;
}

export type CreateSandboxParams =
  | (SandboxCreateCommonParams & {
      snapshotName: string;
      snapshotId?: string;
      imageName?: never;
      imageId?: never;
    })
  | (SandboxCreateCommonParams & {
      snapshotName?: never;
      snapshotId?: never;
      imageName: string;
      imageId?: string;
    });

export interface SandboxListParams {
  status?: SandboxStatus;
  start?: number;
  end?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SandboxListResponse {
  sandboxes: Sandbox[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface SandboxImageSummary {
  id: string;
  imageName: string;
  namespace: string;
  uploaded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxImageListResponse {
  images: SandboxImageSummary[];
  // TODO: add pagination metadata when /api/images supports it.
  // totalCount?: number;
  // page?: number;
  // perPage?: number;
}

export type SandboxSnapshotStatus = "creating" | "created" | "failed";

export interface SandboxSnapshotSummary {
  id: string;
  snapshotName: string;
  namespace: string;
  imageNamespace: string;
  imageName: string;
  imageId: string;
  status: SandboxSnapshotStatus;
  compatibilityTag: string;
  metadata: Record<string, unknown>;
  uploaded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxSnapshotListParams {
  status?: SandboxSnapshotStatus;
  imageName?: string;
  limit?: number;
}

export interface SandboxSnapshotListResponse {
  snapshots: SandboxSnapshotSummary[];
  // TODO: add pagination metadata when /api/snapshots supports it.
  // totalCount?: number;
  // page?: number;
  // perPage?: number;
}

export interface SandboxMemorySnapshotParams {
  snapshotName?: string;
}

export interface SandboxMemorySnapshotResult {
  snapshotName: string;
  snapshotId: string;
  namespace: string;
  status: string;
  imageName: string;
  imageId: string;
  imageNamespace: string;
}

export interface SandboxExposeParams {
  port: number;
  auth?: boolean;
}

export interface SandboxExposeResult {
  port: number;
  auth: boolean;
  url: string;
  browserUrl?: string;
  browserUrlExpiresAt?: string | null;
}

export interface SandboxUnexposeResult {
  port: number;
  exposed: boolean;
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

export type SandboxProcessSignal = "TERM" | "KILL" | "INT" | "HUP" | "QUIT" | string;

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
  encoding?: "utf8" | "base64";
  append?: boolean;
  mode?: string;
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

export type SandboxFileSystemEventType = "chmod" | "create" | "remove" | "rename" | "write";

export interface SandboxFileSystemEvent {
  name: string;
  type: SandboxFileSystemEventType;
}

export interface SandboxWatchDirOptions {
  recursive?: boolean;
  // Optional client-side auto-stop. Omit to keep the watch open until stop() is called.
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

export interface SandboxTerminalOutputChunk {
  seq: number;
  data: string;
  raw: Buffer;
  timestamp: number;
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
  output?: SandboxTerminalOutputChunk[];
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
  | ({
      type: "output";
    } & SandboxTerminalOutputChunk)
  | {
      type: "exit";
      status: SandboxTerminalStatus;
    };
