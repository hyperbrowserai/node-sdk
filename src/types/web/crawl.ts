import {
  FetchStealthMode,
  FetchOutputOptions,
  FetchBrowserOptions,
  FetchNavigationOptions,
  FetchCacheOptions,
  PageData,
} from "./common";

export type WebCrawlJobStatus = "pending" | "running" | "completed" | "failed";

export interface WebCrawlOptions {
  maxPages?: number;
  ignoreSitemap?: boolean;
  followLinks?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
}

export interface StartWebCrawlJobParams {
  url: string;
  stealth?: FetchStealthMode;
  outputs?: FetchOutputOptions;
  browser?: FetchBrowserOptions;
  navigation?: FetchNavigationOptions;
  cache?: FetchCacheOptions;
  crawlOptions?: WebCrawlOptions;
}

export interface GetWebCrawlJobParams {
  page?: number;
  batchSize?: number;
}

export interface StartWebCrawlJobResponse {
  jobId: string;
}

export interface WebCrawlJobStatusResponse {
  status: WebCrawlJobStatus;
}

export interface WebCrawlJobResponse {
  jobId: string;
  status: WebCrawlJobStatus;
  data?: PageData[];
  error?: string;
  totalPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
