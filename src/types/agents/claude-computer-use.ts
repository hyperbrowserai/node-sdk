import { ClaudeComputerUseLlm, ClaudeComputerUseTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface ClaudeComputerUseApiKeys {
  anthropic?: string;
}

export interface StartClaudeComputerUseTaskParams {
  task: string;
  llm?: ClaudeComputerUseLlm;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: ClaudeComputerUseApiKeys;
}

export interface StartClaudeComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface ClaudeComputerUseTaskStatusResponse {
  status: ClaudeComputerUseTaskStatus;
}

export interface ClaudeComputerUseStepResponse {
  role: string;
  type: string;
  model: string;
  content: any[];
  stop_reason: string | null;
  stop_sequence: string | null;
}

export interface ClaudeComputerUseTaskData {
  steps: ClaudeComputerUseStepResponse[];
  finalResult: string | null;
}

export interface ClaudeComputerUseTaskResponse {
  jobId: string;
  status: ClaudeComputerUseTaskStatus;
  data?: ClaudeComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
