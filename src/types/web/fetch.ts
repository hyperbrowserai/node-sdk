import {
  FetchStealthMode,
  FetchOutputOptions,
  FetchBrowserOptions,
  FetchNavigationOptions,
  FetchCacheOptions,
} from "./common";

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
  metadata?: Record<string, string | string[]>;
  html?: string;
  markdown?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, any>;
}

export interface FetchResponse {
  jobId: string;
  status: FetchStatus;
  error?: string;
  data?: FetchResponseData;
}
