import fs from "fs";
import {
  Country,
  DownloadsStatus,
  ISO639_1,
  OperatingSystem,
  Platform,
  RecordingStatus,
  SessionEventLogType,
  SessionRegion,
  State,
} from "./constants";

export type SessionStatus = "active" | "closed" | "error";

export interface BasicResponse {
  success: boolean;
}

export interface SessionProfile {
  id: string;
  persistChanges?: boolean;
}

export interface SessionLaunchState {
  useUltraStealth?: boolean;
  useStealth?: boolean;
  useProxy?: boolean;
  solveCaptchas?: boolean;
  adblock?: boolean;
  trackers?: boolean;
  annoyances?: boolean;
  screen?: ScreenConfig;
  enableWebRecording?: boolean;
  enableVideoWebRecording?: boolean;
  enableLogCapture?: boolean;
  acceptCookies?: boolean;
  profile?: SessionProfile;
  staticIpId?: string;
  saveDownloads?: boolean;
  enableWindowManager?: boolean;
  enableWindowManagerTaskbar?: boolean;
  viewOnlyLiveView?: boolean;
  disablePasswordManager?: boolean;
  enableAlwaysOpenPdfExternally?: boolean;
  appendTimestampToDownloads?: boolean;
}

export interface Session {
  id: string;
  teamId: string;
  status: SessionStatus;
  startTime?: number;
  endTime?: number;
  createdAt: string;
  updatedAt: string;
  sessionUrl: string;
  launchState?: SessionLaunchState | null;
  creditsUsed: number | null;
}

export interface SessionDetail extends Session {
  wsEndpoint: string;
  computerActionEndpoint?: string;
  webdriverEndpoint?: string;
  liveUrl?: string;
  token: string;
}

export interface SessionListParams {
  status?: SessionStatus;
  page?: number;
  limit?: number;
}

export interface SessionListResponse {
  sessions: Session[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface ScreenConfig {
  width: number;
  height: number;
}

export interface CreateSessionProfile {
  id?: string;
  persistChanges?: boolean;
  persistNetworkCache?: boolean;
}

export interface ImageCaptchaParam {
  imageSelector: string;
  inputSelector: string;
}

export interface CreateSessionParams {
  useUltraStealth?: boolean;
  useStealth?: boolean;
  useProxy?: boolean;
  proxyServer?: string;
  proxyServerPassword?: string;
  proxyServerUsername?: string;
  proxyCountry?: Country;
  proxyState?: State;
  proxyCity?: string;
  operatingSystems?: OperatingSystem[];
  device?: ("desktop" | "mobile")[];
  platform?: Platform[];
  locales?: ISO639_1[];
  screen?: ScreenConfig;
  solveCaptchas?: boolean;
  adblock?: boolean;
  trackers?: boolean;
  annoyances?: boolean;
  enableWebRecording?: boolean;
  enableVideoWebRecording?: boolean;
  enableLogCapture?: boolean;
  profile?: CreateSessionProfile;
  extensionIds?: Array<string>;
  staticIpId?: string;
  acceptCookies?: boolean;
  urlBlocklist?: string[];
  browserArgs?: string[];
  saveDownloads?: boolean;
  imageCaptchaParams?: Array<ImageCaptchaParam>;
  timeoutMinutes?: number;
  enableWebglFingerprinting?: boolean;
  enableWindowManager?: boolean;
  enableWindowManagerTaskbar?: boolean;
  region?: SessionRegion;
  viewOnlyLiveView?: boolean;
  disablePasswordManager?: boolean;
  enableAlwaysOpenPdfExternally?: boolean;
  appendTimestampToDownloads?: boolean;
  showScrollbars?: boolean;
  replaceNativeElements?: boolean;
}

export interface SessionRecording {
  type: number;
  data: unknown;
  timestamp: number;
  delay?: number;
}

export interface GetSessionRecordingUrlResponse {
  status: RecordingStatus;
  recordingUrl?: string | null;
  error?: string | null;
}

export interface GetSessionVideoRecordingUrlResponse {
  status: RecordingStatus;
  recordingUrl?: string | null;
  error?: string | null;
}

export interface GetSessionDownloadsUrlResponse {
  status: DownloadsStatus;
  downloadsUrl?: string | null;
  error?: string | null;
}

export interface UploadFileResponse {
  message: string;
}

export interface UploadFileOptions {
  fileInput: string | fs.ReadStream | Buffer;
  fileName?: string;
}

export interface GetActiveSessionsCountResponse {
  activeSessionsCount: number;
}

export interface SessionEventLog {
  id: string;
  sessionId: string;
  targetId: string | null;
  pageUrl: string | null;
  teamId: string;
  type: SessionEventLogType;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface SessionEventLogListParams {
  page?: number;
  limit?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  targetId?: string;
  types?: SessionEventLogType[];
}

export interface SessionEventLogListResponse {
  data: SessionEventLog[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface UpdateSessionProfileParams {
  persistChanges?: boolean;
  persistNetworkCache?: boolean;
}
