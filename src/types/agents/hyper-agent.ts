import { HyperAgentLlm, HyperAgentTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface HyperAgentApiKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
}

export interface StartHyperAgentTaskParams {
  task: string;
  llm?: HyperAgentLlm;
  sessionId?: string;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: HyperAgentApiKeys;
}

export interface StartHyperAgentTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface HyperAgentTaskStatusResponse {
  status: HyperAgentTaskStatus;
}

export interface HyperAgentActionOutput {
  success: boolean;
  message: string;
  extract?: object;
}

export interface HyperAgentOutput {
  thoughts: string;
  memory: string;
  nextGoal: string;
  actions: {
    [x: string]: any;
  }[];
}

export interface HyperAgentStep {
  idx: number;
  agentOutput: HyperAgentOutput;
  actionOutputs: HyperAgentActionOutput[];
}

export interface HyperAgentTaskData {
  steps: HyperAgentStep[];
  finalResult: string | null;
}

export interface HyperAgentTaskMetadata {
  numTaskStepsCompleted?: number | null;
}

export interface HyperAgentTaskResponse {
  jobId: string;
  status: HyperAgentTaskStatus;
  metadata?: HyperAgentTaskMetadata | null;
  data?: HyperAgentTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
