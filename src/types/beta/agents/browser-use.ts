import { Llm, TaskJobStatus } from "../../constants";
import { CreateSessionParams } from "../../session";

export interface StartBrowserUseJobParams {
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

export interface StartBrowserUseJobResponse {
  jobId: string;
}

export interface BrowserUseJobStatusResponse {
  status: TaskJobStatus;
}

export interface BrowserUseJobResponse {
  jobId: string;
  status: TaskJobStatus;
  data?: object | null;
  error?: string | null;
}
