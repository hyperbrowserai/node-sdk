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
import { SessionCredential, SessionCredentialSource } from "./credential";

export type SessionStatus = "active" | "closed" | "close-error" | "error";
export type BrowserMemorySize = "small" | "medium" | "large";

export interface BasicResponse {
  success: boolean;
}

export interface SessionProfile {
  id: string;
  persistChanges?: boolean;
}

/** How a session signs its requests with Web Bot Auth. */
export interface SessionWebBotAuth {
  /** The identity the session signs as, e.g. "https://www.hyperbrowser.ai". */
  signatureAgent: string;
  /** Present when signing is limited to these hostnames and their subdomains. */
  onlyDomains?: string[];
}

export interface SessionLaunchState {
  enableWebMcp?: boolean;
  /** Present only for a session that signs its requests with Web Bot Auth. */
  webBotAuth?: SessionWebBotAuth;
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
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
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
  /** The secrets attached at creation, when any were requested. */
  credentials?: SessionCredential[];
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

export interface StartSessionFromSnapshotParams {
  snapshotId: string;
}

export interface WebBotAuthParams {
  /**
   * Sign only requests to these hostnames (e.g. "example.com") and their
   * subdomains. No scheme, port or path; at most 50.
   */
  onlyDomains?: string[];
}

export interface ProxyRoute {
  /**
   * The hosts this route applies to: a hostname, "*.example.com" (subdomains,
   * not example.com itself) or "*" (every host), or a list of them.
   */
  match: string | string[];
  /**
   * "direct" sends the traffic straight out of the browser's machine;
   * "default" sends it through the session's proxy.
   */
  proxy: "direct" | "default";
}

export interface CreateSessionParams {
  /** Enable page-provided WebMCP tools. Defaults to false on the server. */
  enableWebMcp?: boolean;
  /**
   * Sign the session's requests with Web Bot Auth so websites can verify they
   * come from Hyperbrowser. Pass `{ onlyDomains }` to sign only for those
   * hosts. Requires Web Bot Auth to be enabled for your team; works for
   * sessions and agent tasks, and cannot be combined with `useUltraStealth`
   * or `startFromSnapshot`.
   */
  webBotAuth?: boolean | WebBotAuthParams;
  /**
   * Choose, per host, whether the session's traffic goes through its proxy or
   * straight out. The first route that matches a host decides; hosts that no
   * route matches use the proxy. Requires `useProxy` and proxy routes to be
   * enabled for your team, only applies when creating a session, and cannot
   * be combined with `allowInternetAccess: false`, `allowOut` or `denyOut`.
   */
  proxyRoutes?: ProxyRoute[];
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
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
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
  replaceNativeElements?: boolean;
  disablePostQuantumKeyAgreement?: boolean;
  browserMemorySize?: BrowserMemorySize;
  startFromSnapshot?: StartSessionFromSnapshotParams;
  /**
   * Secrets that `sessions.credentials.fill` may type into pages, at most 20:
   * a secret's name (or `{ secret: name }`), or `{ vault: name }` for the
   * secrets a stored vault's entries name when the session is created.
   * Secrets need allowed origins to be filled. They can only be attached at
   * creation; the session runs on Firecracker with Chrome's password manager
   * off.
   */
  credentials?: SessionCredentialSource[];
}

export interface CreateSessionSnapshotResponse {
  snapshotName: string;
  snapshotId: string;
  namespace: string;
  status: string;
  uploaded: boolean;
  ready: boolean;
  imageName: string;
  imageId: string;
  imageNamespace: string;
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
