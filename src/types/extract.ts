import { z } from "zod";
import { ExtractJobStatus } from "./constants";
import { CreateSessionParams } from "./session";

export interface StartExtractJobParams {
  urls: string[];
  systemPrompt?: string;
  prompt?: string;
  schema?: z.ZodSchema | object;
  waitFor?: number;
  sessionOptions?: CreateSessionParams;
  maxLinks?: number;
}

export interface StartExtractJobResponse {
  jobId: string;
}

export interface ExtractJobStatusResponse {
  status: ExtractJobStatus;
}

export interface ExtractJobMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numPagesScraped?: number | null;
}

export interface ExtractJobResponse {
  jobId: string;
  status: ExtractJobStatus;
  metadata?: ExtractJobMetadata | null;
  data?: object;
  error?: string;
}
