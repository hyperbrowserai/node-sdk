import { HyperAgentLlm, HyperAgentTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface StartHyperAgentTaskParams {
  task: string;
  llm?: HyperAgentLlm;
  sessionId?: string;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
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

export interface HyperAgentTaskResponse {
  jobId: string;
  status: HyperAgentTaskStatus;
  data?: HyperAgentTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
