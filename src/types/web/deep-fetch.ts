import { z } from "zod";
import { DeepFetchStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface StartDeepFetchJobParams {
  urls: string[];
  systemPrompt?: string;
  prompt?: string;
  schema?: z.ZodSchema | object;
  waitFor?: number;
  sessionOptions?: CreateSessionParams;
  maxLinks?: number;
}

export interface StartDeepFetchJobResponse {
  jobId: string;
}

export interface DeepFetchJobStatusResponse {
  status: DeepFetchStatus;
}

export interface DeepFetchJobMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numPagesScraped?: number | null;
}

export interface DeepFetchJobResponse {
  jobId: string;
  status: DeepFetchStatus;
  metadata?: DeepFetchJobMetadata | null;
  data?: object;
  error?: string;
}
