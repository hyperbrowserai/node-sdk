import { GrokComputerUseLlm, GrokReasoningEffort, GrokComputerUseTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface GrokComputerUseApiKeys {
  xai?: string;
}

export interface StartGrokComputerUseTaskParams {
  task: string;
  llm?: GrokComputerUseLlm;
  reasoningEffort?: GrokReasoningEffort;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: GrokComputerUseApiKeys;
  useComputerAction?: boolean;
}

export interface StartGrokComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface GrokComputerUseTaskStatusResponse {
  status: GrokComputerUseTaskStatus;
}

export interface GrokComputerUseStepResponse {
  created_at?: string | null;
  completed_at?: string | null;
  output_text?: string | null;
  error?: string | null;
  incomplete_details?: any;
  model?: string | null;
  output?: any[];
  reasoning?: any;
  status?: string | null;
}

export interface GrokComputerUseTaskData {
  steps: GrokComputerUseStepResponse[];
  finalResult: string | null;
}

export interface GrokComputerUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface GrokComputerUseTaskResponse {
  jobId: string;
  status: GrokComputerUseTaskStatus;
  metadata?: GrokComputerUseTaskMetadata | null;
  data?: GrokComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
