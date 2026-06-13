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
  solverType?: CaptchaSolverType;
  profile?: SessionProfile;
  staticIpId?: string;
  saveDownloads?: boolean;
  enableWindowManager?: boolean;
  enableWindowManagerTaskbar?: boolean;
  viewOnlyLiveView?: boolean;
  allowOnGeolocationPrompt?: boolean;
  disablePasswordManager?: boolean;
  enableAlwaysOpenPdfExternally?: boolean;
  appendTimestampToDownloads?: boolean;
  disablePostQuantumKeyAgreement?: boolean;
}

export interface SessionCreditBreakdown {
  creditsUsed: number | null;
  browserTimeCreditsUsed: number | null;
  proxyDataCreditsUsed: number | null;
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
  creditBreakdown: SessionCreditBreakdown;
}

export interface SessionDetail extends Session {
  wsEndpoint: string;
  computerActionEndpoint?: string;
  webdriverEndpoint?: string;
  liveUrl?: string;
  liveDomain?: string;
  token: string;
}

export interface SessionGetParams {
  liveViewTtlSeconds?: number;
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

export type CaptchaSolverType = "visual" | (string & {});

export type CaptchaEvaluationType =
  | "turnstile"
  | "cloudflare-challenge"
  | "aliexpress"
  | "recaptcha"
  | "recaptcha-visual"
  | "amazon";

export type CaptchaEvaluationTarget = CaptchaEvaluationType;

export interface CaptchaEvaluationParams {
  captcha?: CaptchaEvaluationTarget;
  captchaType?: CaptchaEvaluationTarget;
  text?: CaptchaEvaluationTarget;
  iterations?: number;
  maxIterations?: number;
  solverType?: CaptchaSolverType;
  imageCaptchaParams?: Array<ImageCaptchaParam>;
  useGeminiCaptchaSolver?: boolean;
  useUltraStealth?: boolean;
}

export interface CaptchaEvaluationPageResult {
  url: string;
  targetId: string | null;
  iterationsRun: number;
  solved: boolean;
  solvedCaptchas: CaptchaEvaluationType[];
  checkedCaptchas: CaptchaEvaluationType[];
  captchaSolvedCounts: Record<string, number>;
  lastSolveTime: Record<string, number>;
}

export interface CaptchaEvaluationResponse {
  success: true;
  captcha: CaptchaEvaluationType | null;
  iterationsRequested: number;
  iterationsRun: number;
  solved: boolean;
  solvedCaptchas: CaptchaEvaluationType[];
  pages: CaptchaEvaluationPageResult[];
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
  solverType?: CaptchaSolverType;
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
  disabledExternalProtocols?: string[];
  saveDownloads?: boolean;
  imageCaptchaParams?: Array<ImageCaptchaParam>;
  timeoutMinutes?: number;
  enableWebglFingerprinting?: boolean;
  enableWindowManager?: boolean;
  enableWindowManagerTaskbar?: boolean;
  region?: SessionRegion;
  viewOnlyLiveView?: boolean;
  allowOnGeolocationPrompt?: boolean;
  disablePasswordManager?: boolean;
  enableAlwaysOpenPdfExternally?: boolean;
  appendTimestampToDownloads?: boolean;
  showScrollbars?: boolean;
  liveViewTtlSeconds?: number;
  liveDomain?: string;
  replaceNativeElements?: boolean;
  disablePostQuantumKeyAgreement?: boolean;
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
  filePath?: string;
  fileName?: string;
  originalName?: string;
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

export interface UpdateSessionProxyLocationParams {
  country?: Country;
  state?: State;
  city?: string;
}

export interface UpdateSessionProxyParams {
  enabled: boolean;
  staticIpId?: string;
  location?: UpdateSessionProxyLocationParams;
}

export interface UpdateSessionScreenParams {
  width: number;
  height: number;
}

export interface UpdateSessionSolveCaptchasParams {
  solverType?: CaptchaSolverType;
}

export interface UpdateSessionSolveCaptchasResponse extends BasicResponse {
  solveCaptchas?: boolean;
  sessionId?: string;
  telemetryReady?: boolean;
}
