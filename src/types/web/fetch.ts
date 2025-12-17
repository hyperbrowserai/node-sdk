import { FetchStatus } from "../constants";
import { CreateSessionParams } from "../session";
import { WebOutputOptions, FetchOptions, FetchedPage } from "./common";

export interface FetchParams {
  url: string;
  outputs?: WebOutputOptions[];
  sessionOptions?: CreateSessionParams;
  fetchOptions?: FetchOptions;
}

export interface FetchResponseData {
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  json?: object;
}

export interface FetchResponse {
  jobId: string;
  status: FetchStatus;
  data?: FetchResponseData;
  error?: string;
}

export interface StartBatchFetchParams {
  urls: string[];
  outputs?: WebOutputOptions[];
  sessionOptions?: CreateSessionParams;
  fetchOptions?: FetchOptions;
}

export interface GetBatchFetchJobParams {
  page?: number;
  batchSize?: number;
}

export interface StartBatchFetchJobResponse {
  jobId: string;
}

export interface BatchFetchJobStatusResponse {
  status: FetchStatus;
}

export interface BatchFetchJobResponse {
  jobId: string;
  status: FetchStatus;
  data?: FetchedPage[];
  error?: string;
  totalScrapedPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
