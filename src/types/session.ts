import {
  Country,
  DownloadsStatus,
  ISO639_1,
  OperatingSystem,
  Platform,
  RecordingStatus,
  State,
} from "./constants";

export type SessionStatus = "active" | "closed" | "error";

export interface BasicResponse {
  success: boolean;
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
}

export interface SessionDetail extends Session {
  wsEndpoint: string;
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
}

export interface ImageCaptchaParam {
  imageSelector: string;
  inputSelector: string;
}

export interface CreateSessionParams {
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
  profile?: CreateSessionProfile;
  extensionIds?: Array<string>;
  staticIpId?: string;
  acceptCookies?: boolean;
  urlBlocklist?: string[];
  browserArgs?: string[];
  saveDownloads?: boolean;
  imageCaptchaParams?: Array<ImageCaptchaParam>;
  timeoutMinutes?: number;
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

export interface GetSessionDownloadsUrlResponse {
  status: DownloadsStatus;
  downloadsUrl?: string | null;
  error?: string | null;
}
