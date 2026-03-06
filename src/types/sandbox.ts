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

export interface SandboxFileEntry {
  path: string;
  name: string;
  type: string;
  size: number;
  mode: string;
  modTime: number;
}

export interface SandboxFileListParams {
  path: string;
  recursive?: boolean;
  limit?: number;
  cursor?: number;
}

export interface SandboxFileListResponse {
  path: string;
  entries: SandboxFileEntry[];
  limit: number;
  cursor: number;
  recursive: boolean;
  nextCursor?: number;
}

export interface SandboxFileReadParams {
  path: string;
  offset?: number;
  length?: number;
}

export interface SandboxFileReadResult {
  content: string;
  encoding: "utf8" | "base64";
  bytesRead: number;
  truncated: boolean;
  contentType?: string;
}

export interface SandboxFileWriteTextParams {
  path: string;
  data: string;
  append?: boolean;
  mode?: string;
}

export interface SandboxFileWriteBytesParams {
  path: string;
  data: Uint8Array;
  append?: boolean;
  mode?: string;
}

export interface SandboxFileWriteResult {
  bytesWritten: number;
  path: string;
}

export interface SandboxFileUploadParams {
  path: string;
  data: Buffer | Uint8Array | string;
}

export interface SandboxFileDeleteParams {
  path: string;
  recursive?: boolean;
}

export interface SandboxFileMkdirParams {
  path: string;
  parents?: boolean;
  mode?: string;
}

export interface SandboxFileMoveParams {
  source: string;
  destination: string;
  overwrite?: boolean;
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

export interface SandboxFileMutationResult {
  path: string;
}

export interface SandboxFileTransferResult {
  path: string;
  bytesWritten: number;
}

export interface SandboxFileWatchParams {
  path: string;
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
  error?: string;
  createdAt: number;
  stoppedAt?: number;
  lastSeq: number;
  eventCount: number;
  events?: SandboxFileWatchEvent[];
}

export type SandboxFileWatchRoute = "ws" | "stream";

export interface SandboxFileWatchEventsParams {
  cursor?: number;
  route?: SandboxFileWatchRoute;
}

export type SandboxFileWatchStreamEvent =
  | {
      type: "event";
      event: SandboxFileWatchEvent;
    }
  | {
      type: "done";
      status: SandboxFileWatchStatus;
    };

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
