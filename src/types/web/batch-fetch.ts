import {
  FetchBrowserOptions,
  FetchCacheOptions,
  FetchNavigationOptions,
  FetchOutputOptions,
  FetchStealthMode,
  PageData,
} from "./common";

export type BatchFetchJobStatus = "pending" | "running" | "completed" | "failed";

export interface StartBatchFetchJobParams {
  urls: string[];
  stealth?: FetchStealthMode;
  outputs?: FetchOutputOptions;
  browser?: FetchBrowserOptions;
  navigation?: FetchNavigationOptions;
  cache?: FetchCacheOptions;
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
