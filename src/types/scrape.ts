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

export interface ScrapeJobData {
  metadata: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
}

export interface ScrapeJobResponse {
  jobId: string;
  status: ScrapeJobStatus;
  data?: ScrapeJobData;
  error?: string;
}
