import { z } from "zod";
import { ExtractJobStatus } from "./constants";
import { CreateSessionParams } from "./session";

export interface StartExtractJobParams {
  urls: string[];
  systemPrompt?: string;
  prompt?: string;
  schema?: z.ZodSchema | object;
  sessionOptions?: CreateSessionParams;
  maxLinks?: number;
}

export interface StartExtractJobResponse {
  jobId: string;
}

export interface ExtractJobResponse {
  jobId: string;
  status: ExtractJobStatus;
  data?: object;
  error?: string;
}
