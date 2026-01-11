import {
  Country,
  State,
  FetchStatus,
  FetchWaitUntil,
  FetchScreenshotFormat,
  PageStatus,
  BatchFetchJobStatus,
  WebSearchStatus,
  WebSearchFiletype,
  SessionRegion,
} from "./constants";
import { CreateSessionProfile, ImageCaptchaParam, ScreenConfig } from "./session";

export interface FetchSessionOptions {
  useUltraStealth?: boolean;
  useStealth?: boolean;
  useProxy?: boolean;
  proxyServer?: string;
  proxyServerPassword?: string;
  proxyServerUsername?: string;
  proxyCountry?: Country;
  proxyState?: State;
  proxyCity?: string;
  screen?: ScreenConfig;
  solveCaptchas?: boolean;
  adblock?: boolean;
  trackers?: boolean;
  annoyances?: boolean;
  enableWebRecording?: boolean;
  enableVideoWebRecording?: boolean;
  enableLogCapture?: boolean;
  profile?: CreateSessionProfile;
  extensionIds?: string[];
  staticIpId?: string;
  acceptCookies?: boolean;
  browserArgs?: string[];
  imageCaptchaParams?: ImageCaptchaParam[];
  region?: SessionRegion;
}

export interface FetchOutputScreenshotOptions {
  fullPage?: boolean;
  format?: FetchScreenshotFormat;
  cropToContent?: boolean;
  cropToContentMaxHeight?: number;
  cropToContentMinHeight?: number;
  waitFor?: number;
}

export interface FetchStorageStateOptions {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

export interface FetchOptions {
  includeTags?: string[];
  excludeTags?: string[];
  sanitize?: boolean;
  waitFor?: number;
  timeout?: number;
  waitUntil?: FetchWaitUntil;
  storageState?: FetchStorageStateOptions;
}

export interface FetchOutputJsonOptions {
  schema?: unknown;
}

export interface FetchOutputMarkdown {
  type: "markdown";
  options?: Record<string, unknown>;
}

export interface FetchOutputHtml {
  type: "html";
  options?: Record<string, unknown>;
}

export interface FetchOutputLinks {
  type: "links";
  options?: Record<string, unknown>;
}

export interface FetchOutputScreenshot {
  type: "screenshot";
  options?: FetchOutputScreenshotOptions;
}

export interface FetchOutputJson {
  type: "json";
  options: FetchOutputJsonOptions;
}

export type FetchOutputLike =
  | FetchOutputMarkdown
  | FetchOutputHtml
  | FetchOutputLinks
  | FetchOutputScreenshot
  | FetchOutputJson
  | "markdown"
  | "html"
  | "links"
  | "screenshot";

export interface FetchParams {
  url: string;
  outputs?: FetchOutputLike[];
  fetchOptions?: FetchOptions;
  sessionOptions?: FetchSessionOptions;
}

export interface FetchResponseData {
  metadata?: Record<string, string | string[]>;
  html?: string;
  markdown?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, unknown>;
}

export interface FetchResponse {
  jobId: string;
  status: FetchStatus;
  error?: string;
  data?: FetchResponseData;
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
  json?: Record<string, unknown>;
}

export interface StartBatchFetchJobParams {
  urls: string[];
  outputs?: FetchOutputLike[];
  fetchOptions?: FetchOptions;
  sessionOptions?: FetchSessionOptions;
}

export interface GetBatchFetchJobParams {
  page?: number;
  batchSize?: number;
}

export interface StartBatchFetchJobResponse {
  jobId: string;
}

export interface BatchFetchJobStatusResponse {
  status: BatchFetchJobStatus;
}

export interface BatchFetchJobResponse {
  jobId: string;
  status: BatchFetchJobStatus;
  error?: string;
  data?: PageData[];
  totalPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}

export interface WebSearchFilters {
  exactPhrase?: boolean;
  semanticPhrase?: boolean;
  excludeTerms?: string[];
  boostTerms?: string[];
  filetype?: WebSearchFiletype;
  site?: string;
  excludeSite?: string;
  intitle?: string;
  inurl?: string;
}

export interface WebSearchRegion {
  country: Country;
  state?: State;
  city?: string;
}

export interface WebSearchParams {
  query: string;
  page?: number;
  maxAgeSeconds?: number;
  region?: WebSearchRegion;
  filters?: WebSearchFilters;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchResponseData {
  query: string;
  results: WebSearchResultItem[];
}

export interface WebSearchResponse {
  status: WebSearchStatus;
  error?: string;
  data?: WebSearchResponseData;
}
