import { ScrapeFormat, ScrapeJobStatus } from "./constants";
import { CreateSessionParams } from "./session";

export interface ScrapeOptions {
  formats?: ScrapeFormat[];
  includeTags?: string[];
  excludeTags?: string[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
}

export interface StartScrapeJobParams {
  url: string;
  sessionOptions?: CreateSessionParams;
  scrapeOptions?: ScrapeOptions;
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
