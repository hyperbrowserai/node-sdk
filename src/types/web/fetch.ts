import {
  FetchStealthMode,
  FetchOutputOptions,
  FetchBrowserOptions,
  FetchNavigationOptions,
  FetchCacheOptions,
} from "./common";
import { BrandingProfile } from "./branding";

export type FetchStatus = "completed" | "failed" | "pending" | "running";

export interface FetchParams {
  url: string;
  stealth?: FetchStealthMode;
  outputs?: FetchOutputOptions;
  browser?: FetchBrowserOptions;
  navigation?: FetchNavigationOptions;
  cache?: FetchCacheOptions;
}

export interface FetchResponseData {
  metadata?: Record<string, unknown>;
  /**
   * HTTP status of the page the content came from. Absent when the browser
   * received no response, and on results cached before this field existed.
   */
  statusCode?: number;
  /**
   * URL the page ended on after redirects. For a document such as a PDF, the
   * URL of the downloaded file.
   */
  finalUrl?: string;
  html?: string;
  markdown?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, any>;
  branding?: BrandingProfile;
}

export interface FetchResponse {
  jobId: string;
  status: FetchStatus;
  error?: string;
  data?: FetchResponseData;
}
