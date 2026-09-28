import type { Blob } from "buffer";
import type { ReadableStream } from "node:stream/web";
import { SessionRegion } from "./constants";
import { SessionLaunchState, SessionStatus } from "./session";

export type SandboxStatus = SessionStatus;

export interface SandboxNetworkPolicy {
  allowInternetAccess?: boolean | null;
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
  runtimeClass?: "firecracker" | "gvisor-cpu";
  capabilities?: {
    commands: boolean;
    files: boolean;
    pty: boolean;
    gpu: boolean;
    snapshots: boolean;
    volumes: boolean;
    exposedPorts: boolean;
    internetAccess: boolean;
    writableStorage: "memory";
  };
  id: string;
  teamId: string;
  status: SandboxStatus;
  endTime?: number | null;
  startTime?: number | null;
  createdAt: string;
  updatedAt: string;
  closeReason?: string | null;
  dataConsumed?: number | null;
  proxyDataConsumed?: number | null;
  usageType?: string | null;
  jobId?: string | null;
  launchState?: SessionLaunchState | null;
  creditsUsed: number | null;
  region: SessionRegion;
  sessionUrl: string;
  duration: number;
  proxyBytesUsed?: number | null;
  cpu?: number | null;
  memoryMiB?: number | null;
  diskMiB?: number | null;
  timeoutMinutes?: number | null;
  network?: SandboxNetworkPolicy | null;
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
  runtimeClass?: "firecracker" | "gvisor-cpu";
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

export interface SandboxImageInit {
  env?: Record<string, string>;
  command?: string;
  args?: string[];
  workingDir?: string;
}

export interface SandboxImageSummary {
  id: string;
  imageName: string;
  namespace: string;
  source?: SandboxImageSource;
  imageInit?: SandboxImageInit | Record<string, unknown> | null;
  uploaded: boolean;
  ready?: boolean | null;
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
  compatibilityTag?: string | null;
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

export interface SandboxImageDeleteResult {
  deleted: boolean;
  id?: string;
  imageName?: string;
  uploaded?: boolean;
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

export type SandboxImageBuildInputFormat =
  | "rootfs_export_tar_gz"
  | "dockerfile_context_tar_gz"
  | "dockerfile_context_manifest_v1"
  | "docker_image_manifest_v1";

export type SandboxImageBuildSourcePlatform = "linux/amd64";

export interface SandboxImageBuildUpload {
  sha256?: string | null;
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

export interface SandboxBuildContextBundle {
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  entryCount: number;
}

export type SandboxBuildContextMode = "sparse" | "full";

export interface SandboxBuildContextManifest {
  version: 1;
  dockerfilePath: string;
  contextMode: SandboxBuildContextMode;
  fallbackReason?: string;
  bundles: SandboxBuildContextBundle[];
}

export interface SandboxDockerImageConfig {
  sha256: string;
  sizeBytes: number;
  dataBase64: string;
}

export interface SandboxDockerImageLayer {
  sha256: string;
  sizeBytes: number;
}

export interface SandboxDockerImageManifest {
  version: 1;
  imageDigest: string;
  descriptor?: SandboxDockerImageConfig;
  config: SandboxDockerImageConfig;
  layers: SandboxDockerImageLayer[];
}

export interface CreateSandboxImageBuildParams {
  imageName: string;
  inputSha256: string;
  inputSizeBytes: number;
  /** Builder vCPUs (sent as `vcpus`). */
  builderCpus?: number;
  /** Builder memory in MiB (sent as `memMiB`). */
  builderMemoryMiB?: number;
  /** Builder scratch disk in MiB (sent as `scratchMiB`). */
  builderScratchMiB?: number;
  inputFormat?: SandboxImageBuildInputFormat;
  sourcePlatform?: SandboxImageBuildSourcePlatform;
  imageConfigUser?: string;
  imageInit?: SandboxImageInit;
  dockerfilePath?: string;
  contextManifest?: SandboxBuildContextManifest;
  dockerImageManifest?: SandboxDockerImageManifest;
}

export interface ReuseSandboxDockerImageParams {
  imageName: string;
  sourceImageDigest: string;
  sourcePlatform?: SandboxImageBuildSourcePlatform;
  imageConfigUser?: string;
  imageInit?: SandboxImageInit;
}

export interface CompleteSandboxImageBuildParams {
  inputSha256: string;
  inputSizeBytes: number;
  inputFormat?: SandboxImageBuildInputFormat;
}

export interface SandboxImageBuildCreateResult {
  build: SandboxImageBuild;
  upload?: SandboxImageBuildUpload | null;
  uploads?: SandboxImageBuildUpload[];
}

export interface SandboxDockerImageReuseResult {
  hit: boolean;
  build?: SandboxImageBuild | null;
}

export type SandboxImageBuildResolutionOutcome = "reused" | "joined" | "created";

/**
 * The result of resolving content-derived image inputs.
 *
 * `imageId` is populated only for a ready image. With `wait: false`, `build`
 * identifies the submitted or joined build, which the caller can poll later.
 */
export interface SandboxImageBuildResolution {
  outcome: SandboxImageBuildResolutionOutcome;
  imageName: string;
  imageId?: string;
  build?: SandboxImageBuild;
}

export interface SandboxImageBuildWaitOptions {
  signal?: AbortSignal;
  /** Seconds between status polls. Defaults to 3. */
  pollInterval?: number;
  /** Seconds to wait before giving up. `null` waits forever. Defaults to 35 minutes. */
  timeout?: number | null;
}

interface SandboxImageBuildCommonOptions {
  /** Cancel this caller's polling; accepted builds and uploads continue independently. */
  signal?: AbortSignal;
  imageName: string;
  platform?: string;
  imageInit?: SandboxImageInit;
  imageConfigUser?: string;
  builderCpus?: number;
  builderMemoryMiB?: number;
  builderScratchMiB?: number;
  /** Wait for the build to complete. Defaults to true. */
  wait?: boolean;
  pollInterval?: number;
  waitTimeout?: number | null;
  /** Directory for temporary packaging artifacts. */
  tempDir?: string;
  /** Per-upload inactivity timeout in seconds. */
  uploadTimeout?: number | null;
}

export interface BuildSandboxImageFromDockerImageOptions extends SandboxImageBuildCommonOptions {
  dockerImage: string;
  expectedImageDigest?: string;
}

export interface BuildSandboxImageFromDockerfileOptions extends SandboxImageBuildCommonOptions {
  contextPath: string;
  dockerfile?: string;
  /** Send the build context to Hyperbrowser (default) instead of building with local Docker. */
  remote?: boolean;
  remoteFullContext?: boolean;
  expectedContextFingerprint?: string;
  dockerTag?: string;
  buildArgs?: Record<string, string>;
}

export interface GetOrBuildSandboxImageOptions {
  /** Cancel this caller's polling; accepted builds and uploads continue independently. */
  signal?: AbortSignal;
  contextPath?: string;
  dockerImage?: string;
  imageNamePrefix?: string;
  dockerfile?: string;
  platform?: string;
  remoteFullContext?: boolean;
  expectedContextFingerprint?: string;
  expectedImageDigest?: string;
  imageInit?: SandboxImageInit;
  imageConfigUser?: string;
  builderCpus?: number;
  builderMemoryMiB?: number;
  builderScratchMiB?: number;
  forceBuild?: boolean;
  wait?: boolean;
  pollInterval?: number;
  waitTimeout?: number | null;
  uploadTimeout?: number | null;
  tempDir?: string;
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
  browserUrl?: string | null;
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
  /** Cancel local collection without killing the detached command. */
  signal?: AbortSignal;
  command: string;
  /** Maximum combined stdout/stderr bytes collected locally. Defaults to 64 MiB. */
  maxOutputBytes?: number;
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
  outputTruncated?: boolean;
  lastSeq?: number;
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

export interface SandboxProcessOutputEvent {
  type: "stdout" | "stderr" | "system";
  seq: number;
  data: string;
  timestamp: number;
}

export interface SandboxProcessExitEvent {
  type: "exit";
  result: SandboxProcessResult;
}

export type SandboxProcessStreamEvent = SandboxProcessOutputEvent | SandboxProcessExitEvent;

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

/** True streaming transfer inputs; strings in iterable chunks are UTF-8. */
export type SandboxFileUploadStream =
  | AsyncIterable<Uint8Array | string>
  | Iterable<Uint8Array | string>;
export interface SandboxFileUploadStreamOptions {
  contentLength?: number;
  signal?: AbortSignal;
}
export interface SandboxFileDownloadStreamOptions {
  signal?: AbortSignal;
}
export interface SandboxFileMoveParams {
  source: string;
  destination: string;
  overwrite?: boolean;
}
export interface SandboxFileRenameOptions {
  overwrite?: boolean;
}
export interface SandboxFileWatchParams {
  recursive?: boolean;
}
export interface SandboxFileWatchEvent {
  seq: number;
  path: string;
  op: string;
  timestamp: number;
}
export interface SandboxFileWatchStatus {
  id: string;
  path: string;
  recursive: boolean;
  active: boolean;
  error?: string | null;
  createdAt: number;
  stoppedAt?: number | null;
  oldestSeq?: number;
  lastSeq?: number;
  eventCount?: number;
  events?: SandboxFileWatchEvent[] | null;
}
export interface SandboxFileWatchEventsParams {
  cursor?: number;
  route?: "ws" | "stream";
  signal?: AbortSignal;
}
export type SandboxFileWatchStreamEvent =
  | { type: "event"; event: SandboxFileWatchEvent }
  | { type: "done"; status: SandboxFileWatchStatus };

export type StartSandboxFromSnapshotParams = Extract<CreateSandboxParams, { snapshotName: string }>;
export interface SandboxRuntimeSession {
  sandboxId: string;
  status: SandboxStatus;
  region: SessionRegion;
  token: string;
  tokenExpiresAt: string | null;
  runtime: SandboxRuntimeTarget;
}
