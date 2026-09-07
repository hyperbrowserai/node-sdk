import { MetaComputerUseLlm, MetaReasoningEffort, MetaComputerUseTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface MetaComputerUseApiKeys {
  meta?: string;
}

export interface StartMetaComputerUseTaskParams {
  task: string;
  llm?: MetaComputerUseLlm;
  reasoningEffort?: MetaReasoningEffort;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: MetaComputerUseApiKeys;
  useComputerAction?: boolean;
}

export interface StartMetaComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface MetaComputerUseTaskStatusResponse {
  status: MetaComputerUseTaskStatus;
}

export interface MetaComputerUseStepError {
  code: string;
  message: string;
}

export interface MetaComputerUseStepIncompleteDetails {
  reason?: string;
}

export interface MetaComputerUseStepReasoning {
  effort?: string | null;
  summary?: string | null;
}

export interface MetaComputerUseStepResponse {
  created_at?: number | null;
  completed_at?: number | null;
  output_text?: string | null;
  error?: MetaComputerUseStepError | null;
  incomplete_details?: MetaComputerUseStepIncompleteDetails | null;
  model?: string | null;
  output?: any[];
  reasoning?: MetaComputerUseStepReasoning | null;
  status?: string | null;
}

export interface MetaComputerUseTaskData {
  steps: MetaComputerUseStepResponse[];
  finalResult: string | null;
}

export interface MetaComputerUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface MetaComputerUseTaskResponse {
  jobId: string;
  status: MetaComputerUseTaskStatus;
  metadata?: MetaComputerUseTaskMetadata | null;
  data?: MetaComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
