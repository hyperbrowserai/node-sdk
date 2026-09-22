import { JevComputerUseLlm, JevComputerUseTaskStatus, JevTextLlm } from "../constants";
import { CreateSessionParams } from "../session";

export interface JevComputerUseApiKeys {
  jev?: string;
  google?: string;
}

export interface StartJevComputerUseTaskParams {
  task: string;
  llm?: JevComputerUseLlm;
  textLlm?: JevTextLlm;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: JevComputerUseApiKeys;
}

export interface StartJevComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface JevComputerUseTaskStatusResponse {
  status: JevComputerUseTaskStatus;
}

export type JevComputerUseStepResponse = Record<string, any>;

export interface JevComputerUseTaskData {
  steps: JevComputerUseStepResponse[];
  finalResult: string | null;
  reachedMaxSteps?: boolean;
  finalUrl?: string | null;
  warnings?: string[];
}

export interface JevComputerUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface JevComputerUseTaskResponse {
  jobId: string;
  status: JevComputerUseTaskStatus;
  metadata?: JevComputerUseTaskMetadata | null;
  data?: JevComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
