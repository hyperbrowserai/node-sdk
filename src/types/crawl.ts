import { CrawlJobStatus, CrawlPageStatus } from "./constants";
import { ScrapeOptions } from "./scrape";

export interface StartCrawlJobParams {
  url: string;
  maxPages?: number;
  followLinks?: boolean;
  ignoreSitemap?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  useProxy?: boolean;
  solveCaptchas?: boolean;
  options?: ScrapeOptions;
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
  metadata: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
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
