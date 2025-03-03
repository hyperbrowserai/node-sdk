import { BrowserUseLlm, BrowserUseTaskStatus } from "../../constants";
import { CreateSessionParams } from "../../session";

export interface StartBrowserUseTaskParams {
  task: string;
  llm?: BrowserUseLlm;
  sessionId?: string;
  validateOutput?: boolean;
  useVision?: boolean;
  useVisionForPlanner?: boolean;
  maxActionsPerStep?: number;
  maxInputTokens?: number;
  plannerLlm?: BrowserUseLlm;
  pageExtractionLlm?: BrowserUseLlm;
  plannerInterval?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
}

export interface StartBrowserUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface BrowserUseTaskStatusResponse {
  status: BrowserUseTaskStatus;
}

export interface BrowserUseAgentBrain {
  evaluation_previous_goal: string;
  memory: string;
  next_goal: string;
}

export interface BrowserUseAgentOutput {
  current_state: BrowserUseAgentBrain;
  action: object[];
}

export interface BrowserUseActionResult {
  is_done?: boolean | null;
  success?: boolean | null;
  extracted_content?: string | null;
  error?: string | null;
  include_in_memory?: boolean | null;
}

export interface BrowserUseStepMetadata {
  step_start_time: number;
  step_end_time: number;
  input_tokens: number;
  step_number: number;
}

export interface BrowserUseTabInfo {
  page_id: number;
  url: string;
  title: string;
}

export interface BrowserUseBrowserStateHistory {
  url: string;
  title: string;
  tabs: BrowserUseTabInfo[];
  interacted_element: (object | null)[] | null[];
  screenshot?: string | null;
}

export interface BrowserUseAgentHistory {
  model_output: BrowserUseAgentOutput | null;
  result: BrowserUseActionResult[];
  state: BrowserUseBrowserStateHistory;
  metadata?: BrowserUseStepMetadata | null;
}

export interface BrowserUseTaskData {
  steps: BrowserUseAgentHistory[];
  finalResult: string | null;
}

export interface BrowserUseTaskResponse {
  jobId: string;
  status: BrowserUseTaskStatus;
  data?: BrowserUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
