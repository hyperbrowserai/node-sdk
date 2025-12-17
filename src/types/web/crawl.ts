import { CrawlJobStatus } from "../constants";
import { FetchedPage, FetchOptions, WebOutputOptions } from "./common";
import { CreateSessionParams } from "../session";

export interface StartWebCrawlJobParams {
  url: string;
  outputs?: WebOutputOptions[];
  maxPages?: number;
  followLinks?: boolean;
  ignoreSitemap?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  sessionOptions?: CreateSessionParams;
  fetchOptions?: FetchOptions;
}

export interface StartWebCrawlJobResponse {
  jobId: string;
}

export interface GetWebCrawlJobParams {
  page?: number;
  batchSize?: number;
}

export interface WebCrawlJobStatusResponse {
  status: CrawlJobStatus;
}

export interface WebCrawlJobResponse {
  jobId: string;
  status: CrawlJobStatus;
  data?: FetchedPage[];
  error?: string;
  totalCrawledPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
