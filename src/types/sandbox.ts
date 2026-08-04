import type { Blob } from "buffer";
import type { ReadableStream } from "node:stream/web";
import { SessionRegion } from "./constants";
import { SessionLaunchState, SessionStatus } from "./session";

export type SandboxStatus = SessionStatus;

export interface SandboxNetworkPolicy {
  allowInternetAccess: boolean;
  allowOut: string[];
  denyOut: string[];
}

export interface SandboxNetworkPolicyPatch {
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
}

export interface SandboxNetworkUpdateResult {
  network: SandboxNetworkPolicy;
}

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
  cpu?: number | null;
  memoryMiB?: number | null;
  diskMiB?: number | null;
  timeoutMinutes?: number | null;
  network?: SandboxNetworkPolicy;
  runtime: SandboxRuntimeTarget;
  exposedPorts: SandboxExposeResult[];
}

export interface SandboxDetail extends Sandbox {
  token: string | null;
  tokenExpiresAt: string | null;
}

export type SandboxVolumeMountType = "rw" | "ro";

export interface SandboxVolumeMount {
  id: string;
  type?: SandboxVolumeMountType;
  shared?: boolean;
}

interface SandboxCreateCommonParams {
  region?: SessionRegion;
  enableRecording?: boolean;
  exposedPorts?: SandboxExposeParams[];
  mounts?: Record<string, SandboxVolumeMount>;
  timeoutMinutes?: number;
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
}

export type CreateSandboxParams =
  | (SandboxCreateCommonParams & {
      snapshotName: string;
      snapshotId?: string;
      imageName?: never;
      imageId?: never;
      cpu?: never;
      memoryMiB?: never;
      diskMiB?: never;
    })
  | (SandboxCreateCommonParams & {
      snapshotName?: never;
      snapshotId?: never;
      imageName: string;
      imageId?: string;
      cpu?: number;
      memoryMiB?: number;
      diskMiB?: number;
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

export type SandboxImageSource = "public" | "team";

export interface SandboxImageSummary {
  id: string;
  imageName: string;
  namespace: string;
  source?: SandboxImageSource;
  imageInit?: Record<string, unknown> | null;
  uploaded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxImageListParams {
  source?: SandboxImageSource | SandboxImageSource[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface SandboxImageListResponse {
  images: SandboxImageSummary[];
  totalCount?: number;
  page?: number;
  perPage?: number;
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
  vcpus?: number | null;
  memMiB?: number | null;
  diskSizeMiB?: number | null;
  compatibilityTag: string;
  metadata: Record<string, unknown>;
  uploaded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxSnapshotListParams {
  status?: SandboxSnapshotStatus | SandboxSnapshotStatus[];
  imageName?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SandboxSnapshotListResponse {
  snapshots: SandboxSnapshotSummary[];
  totalCount?: number;
  page?: number;
  perPage?: number;
}

export interface SandboxSnapshotDeleteResult {
  deleted: boolean;
}

export type SandboxImageBuildStatus =
  | "awaiting_upload"
  | "upload_verified"
  | "dispatching"
  | "building"
  | "verifying"
  | "completed"
  | "failed"
  | "canceled";

export interface SandboxImageBuildUpload {
  url: string;
  method: string;
  headers: Record<string, string>;
  objectKey: string;
  expiresInSeconds: number;
  maxUploadBytes: number;
}

export interface SandboxImageBuild {
  id: string;
  teamId?: string | null;
  userId?: string | null;
  namespace?: string | null;
  imageName: string;
  imageId?: string | null;
  status: SandboxImageBuildStatus;
  inputBucket?: string | null;
  inputKey?: string | null;
  inputSha256?: string | null;
  inputSizeBytes?: number | null;
  outputBucket?: string | null;
  outputKey?: string | null;
  vmId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CreateSandboxImageBuildParams {
  imageName: string;
  inputSha256: string;
  inputSizeBytes: number;
  inputFormat?: "rootfs_export_tar_gz";
  sourcePlatform?: "linux/amd64";
  imageConfigUser?: string;
  imageInit?: {
    env?: Record<string, string>;
    command?: string;
    args?: string[];
  };
}

export interface CompleteSandboxImageBuildParams {
  inputSha256: string;
  inputSizeBytes: number;
  inputFormat?: "rootfs_export_tar_gz";
}

export interface SandboxImageBuildCreateResult {
  build: SandboxImageBuild;
  upload: SandboxImageBuildUpload;
}

export interface SandboxImageBuildListParams {
  status?: SandboxImageBuildStatus;
  limit?: number;
}

export interface SandboxImageBuildListResponse {
  builds: SandboxImageBuild[];
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
  /** @deprecated Legacy compatibility only. Converted into a single shell command string. */
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  timeoutSec?: number;
  runAs?: string;
  /** @deprecated Ignored for process APIs. */
  useShell?: boolean;
}

export type SandboxExecOptions = Omit<SandboxExecParams, "command">;

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
