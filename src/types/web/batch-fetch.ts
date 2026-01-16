import {
  FetchStealthMode,
  FetchOutputOptions,
  FetchBrowserOptions,
  FetchNavigationOptions,
  FetchCacheOptions,
  PageData,
} from "./common";
import { FetchStatus } from "./fetch";

export type BatchFetchJobStatus = FetchStatus;

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
