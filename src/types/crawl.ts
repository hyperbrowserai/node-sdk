import { CrawlJobStatus } from "./constants";

export interface StartCrawlJobParams {
  url: string;
  maxPages?: number;
  followLinks?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  useProxy?: boolean;
  solveCaptchas?: boolean;
}

export interface StartCrawlJobResponse {
  jobId: string;
}

export interface GetCrawlJobParams {
  page?: number;
  batchSize?: number;
}

export interface CrawledPageMetadata {
  title: string;
  description: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogImage: string;
  ogLocaleAlternate: string[];
  ogSiteName: string;
  sourceURL: string;
}

export interface CrawledPage {
  url: string;
  metadata: CrawledPageMetadata;
  markdown: string;
}

export interface CrawlJobResponse {
  status: CrawlJobStatus;
  data?: CrawledPage[];
  error?: string;
  totalCrawledPages: number;
  totalPageBatches: number;
  currentPageBatch: number;
  batchSize: number;
}
