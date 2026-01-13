import { Country, State } from "../constants";
import { ScreenConfig } from "../session";

export type FetchStealthMode = "none" | "auto" | "ultra";
export type FetchSanitizeMode = "none" | "basic" | "advanced";
export type FetchWaitUntil = "load" | "domcontentloaded" | "networkidle";
export type FetchScreenshotFormat = "jpeg" | "png" | "webp";
export type PageStatus = "completed" | "failed" | "pending" | "running";

export interface FetchOutputScreenshotOptions {
  fullPage?: boolean;
  format?: FetchScreenshotFormat;
  cropToContent?: boolean;
  cropToContentMaxHeight?: number;
  cropToContentMinHeight?: number;
}

export interface FetchStorageStateOptions {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

export interface FetchBrowserLocationOptions {
  country?: Country;
  state?: State;
  city?: string;
}

export interface PageData {
  url: string;
  status: PageStatus;
  error?: string;
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, any>;
}

export interface FetchOutputMarkdown {
  type: "markdown";
}

export interface FetchOutputHtml {
  type: "html";
}

export interface FetchOutputLinks {
  type: "links";
}

export interface FetchOutputScreenshot extends FetchOutputScreenshotOptions {
  type: "screenshot";
}

export interface FetchOutputJsonOptions {
  schema?: any;
}

export interface FetchOutputJson extends FetchOutputJsonOptions {
  type: "json";
}

export type FetchOutputFormat =
  | FetchOutputMarkdown
  | FetchOutputHtml
  | FetchOutputLinks
  | FetchOutputScreenshot
  | FetchOutputJson
  | "markdown"
  | "html"
  | "links"
  | "screenshot";

export interface FetchOutputOptions {
  formats?: FetchOutputFormat[];
  sanitize?: FetchSanitizeMode;
  includeSelectors?: string[];
  excludeSelectors?: string[];
  storageState?: FetchStorageStateOptions;
}

export interface FetchBrowserOptions {
  screen?: ScreenConfig;
  profileId?: string;
  solveCaptchas?: string;
  location?: FetchBrowserLocationOptions;
}

export interface FetchNavigationOptions {
  waitUntil?: FetchWaitUntil;
  timeoutMs?: number;
  waitFor?: number;
}

export interface FetchCacheOptions {
  maxAgeSeconds?: number;
}
