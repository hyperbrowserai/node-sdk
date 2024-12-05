import { ScrapeJobStatus } from "./constants";

export interface StartScrapeJobParams {
  url: string;
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
  status: ScrapeJobStatus;
  data?: ScrapeJobData;
  error?: string;
}
