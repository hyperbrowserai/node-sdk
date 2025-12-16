import { HyperAgentLlm, HyperAgentTaskStatus, HyperAgentVersion } from "../constants";
import { CreateSessionParams } from "../session";

export interface HyperAgentApiKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
}

export interface StartHyperAgentTaskParams {
  task: string;
  version?: HyperAgentVersion;
  llm?: HyperAgentLlm;
  sessionId?: string;
  maxSteps?: number;
  enableVisualMode?: boolean;
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

export interface HyperAgentOutputV110 {
  thoughts: string;
  memory: string;
  action: Record<string, unknown>;
}

export interface HyperAgentStep {
  idx: number;
  agentOutput: HyperAgentOutput;
  actionOutputs: HyperAgentActionOutput[];
}

export interface HyperAgentStepV110 {
  idx: number;
  agentOutput: HyperAgentOutputV110;
  actionOutput: HyperAgentActionOutput;
}

export interface HyperAgentTaskData {
  steps: HyperAgentStep[] | HyperAgentStepV110[];
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
