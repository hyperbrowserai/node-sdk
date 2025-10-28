import { GeminiComputerUseLlm, GeminiComputerUseTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface GeminiComputerUseApiKeys {
  google?: string;
}

export interface StartGeminiComputerUseTaskParams {
  task: string;
  llm?: GeminiComputerUseLlm;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: GeminiComputerUseApiKeys;
  useComputerAction?: boolean;
}

export interface StartGeminiComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface GeminiComputerUseTaskStatusResponse {
  status: GeminiComputerUseTaskStatus;
}

export interface GeminiComputerUseStepResponse {
  candidates?: any[];
  modelVersion?: string;
}

export interface GeminiComputerUseTaskData {
  steps: GeminiComputerUseStepResponse[];
  finalResult: string | null;
}

export interface GeminiComputerUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface GeminiComputerUseTaskResponse {
  jobId: string;
  status: GeminiComputerUseTaskStatus;
  metadata?: GeminiComputerUseTaskMetadata | null;
  data?: GeminiComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
