import { Llm, TaskJobStatus } from "./constants";
import { CreateSessionParams } from "./session";

export interface StartTaskJobParams {
  task: string;
  llm?: Llm;
  sessionId?: string;
  validateOutput?: boolean;
  useVision?: boolean;
  useVisionForPlanner?: boolean;
  maxActionsPerStep?: number;
  maxInputTokens?: number;
  plannerLlm?: Llm;
  pageExtractionLlm?: Llm;
  plannerInterval?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
}

export interface StartTaskJobResponse {
  jobId: string;
}

export interface TaskJobStatusResponse {
  status: TaskJobStatus;
}

export interface TaskJobResponse {
  jobId: string;
  status: TaskJobStatus;
  data?: object | null;
  error?: string | null;
}
