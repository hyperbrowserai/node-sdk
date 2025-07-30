import { CuaTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export interface CuaApiKeys {
  openai?: string;
}

export interface StartCuaTaskParams {
  task: string;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: CuaApiKeys;
  useComputerAction?: boolean;
}

export interface StartCuaTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface CuaTaskStatusResponse {
  status: CuaTaskStatus;
}

export interface CuaStepResponseError {
  code: string;
  message: string;
}

export interface CuaStepIncompleteDetails {
  reason?: string;
}

export interface CuaStepReasoning {
  effort: string | null;
  generate_summary?: string | null;
}

export interface CuaStepResponse {
  created_at: number;
  output_text: string;
  error: CuaStepResponseError | null;
  incomplete_details: CuaStepIncompleteDetails | null;
  model: string;
  output: Array<any>;
  reasoning?: CuaStepReasoning | null;
  status?: string;
}

export interface CuaTaskData {
  steps: CuaStepResponse[];
  finalResult: string | null;
}

export interface CuaTaskResponse {
  jobId: string;
  status: CuaTaskStatus;
  data?: CuaTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
