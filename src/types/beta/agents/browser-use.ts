import { BrowserUseLlm, TaskJobStatus } from "../../constants";
import { CreateSessionParams } from "../../session";

export interface StartBrowserUseJobParams {
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

export interface StartBrowserUseJobResponse {
  jobId: string;
}

export interface BrowserUseJobStatusResponse {
  status: TaskJobStatus;
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

export interface AgentHistory {
  model_output: BrowserUseAgentOutput | null;
  result: BrowserUseActionResult[];
  state: BrowserUseBrowserStateHistory;
  metadata?: BrowserUseStepMetadata | null;
}

export interface BrowserUseJobData {
  history: AgentHistory[];
}

export interface BrowserUseJobResponse {
  jobId: string;
  status: TaskJobStatus;
  data?: BrowserUseJobData | null;
  error?: string | null;
}
