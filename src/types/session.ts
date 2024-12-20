import { Country, ISO639_1, OperatingSystem, Platform } from "./constants";

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
  wsEndpoint?: string;
}

export interface SessionListParams {
  status?: SessionStatus;
  page?: number;
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

export interface CreateSessionParams {
  useStealth?: boolean;
  useProxy?: boolean;
  proxyServer?: string;
  proxyServerPassword?: string;
  proxyServerUsername?: string;
  proxyCountry?: Country;
  operatingSystems?: OperatingSystem[];
  device?: ("desktop" | "mobile")[];
  platform?: Platform[];
  locales?: ISO639_1[];
  screen?: ScreenConfig;
  solveCaptchas?: boolean;
  adblock?: boolean;
  trackers?: boolean;
  annoyances?: boolean;
}
