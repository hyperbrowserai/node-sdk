import { CrawlJobStatus, CrawlPageStatus } from "./constants";
import { ScrapeOptions } from "./scrape";
import { CreateSessionParams } from "./session";

export interface StartCrawlJobParams {
  url: string;
  maxPages?: number;
  followLinks?: boolean;
  ignoreSitemap?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  sessionOptions?: CreateSessionParams;
  scrapeOptions?: ScrapeOptions;
}

export interface StartCrawlJobResponse {
  jobId: string;
}

export interface GetCrawlJobParams {
  page?: number;
  batchSize?: number;
}

export interface CrawledPage {
  url: string;
  status: CrawlPageStatus;
  error?: string | null;
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
}

export interface CrawlJobStatusResponse {
  status: CrawlJobStatus;
}

export interface CrawlJobResponse {
  jobId: string;
  status: CrawlJobStatus;
  data?: CrawledPage[];
  error?: string;
  totalCrawledPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
