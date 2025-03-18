import {
  ScrapeFormat,
  ScrapeJobStatus,
  ScrapePageStatus,
  ScrapeScreenshotFormat,
  ScrapeWaitUntil,
} from "./constants";
import { CreateSessionParams } from "./session";

export interface ScreenshotOptions {
  fullPage?: boolean;
  format?: ScrapeScreenshotFormat;
}

export interface ScrapeOptions {
  formats?: ScrapeFormat[];
  includeTags?: string[];
  excludeTags?: string[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  waitUntil?: ScrapeWaitUntil;
  screenshotOptions?: ScreenshotOptions;
}

export interface StartScrapeJobParams {
  url: string;
  sessionOptions?: CreateSessionParams;
  scrapeOptions?: ScrapeOptions;
}

export interface StartScrapeJobResponse {
  jobId: string;
}

export interface ScrapeJobStatusResponse {
  status: ScrapeJobStatus;
}

export interface ScrapeJobData {
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
}

export interface ScrapeJobResponse {
  jobId: string;
  status: ScrapeJobStatus;
  data?: ScrapeJobData;
  error?: string;
}

export interface StartBatchScrapeJobParams {
  urls: string[];
  sessionOptions?: CreateSessionParams;
  scrapeOptions?: ScrapeOptions;
}

export interface ScrapedPage {
  url: string;
  status: ScrapePageStatus;
  error?: string | null;
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
}

export interface GetBatchScrapeJobParams {
  page?: number;
  batchSize?: number;
}

export interface StartBatchScrapeJobResponse {
  jobId: string;
}

export interface BatchScrapeJobStatusResponse {
  status: ScrapeJobStatus;
}

export interface BatchScrapeJobResponse {
  jobId: string;
  status: ScrapeJobStatus;
  data?: ScrapedPage[];
  error?: string;
  totalScrapedPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
