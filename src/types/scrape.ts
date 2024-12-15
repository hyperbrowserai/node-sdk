import { ScrapeFormat, ScrapeJobStatus } from "./constants";

export interface ScrapeOptions {
  formats?: ScrapeFormat[];
  includeTags?: string[];
  excludeTags?: string[];
  onlyMainContent?: boolean;
}

export interface StartScrapeJobParams {
  url: string;
  useProxy?: boolean;
  solveCaptchas?: boolean;
  options?: ScrapeOptions;
}

export interface StartScrapeJobResponse {
  jobId: string;
}

export interface ScrapeJobMetadata {
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

export interface ScrapeJobData {
  metadata: ScrapeJobMetadata;
  markdown: string;
}

export interface ScrapeJobResponse {
  jobId: string;
  status: ScrapeJobStatus;
  data?: ScrapeJobData;
  error?: string;
}
