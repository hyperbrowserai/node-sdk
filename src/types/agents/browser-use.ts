import { z } from "zod";
import { BrowserUseLlm, BrowserUseTaskStatus, BrowserUseVersion } from "../constants";
import { CreateSessionParams } from "../session";

export interface BrowserUseApiKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
}

export interface StartBrowserUseTaskParams {
  task: string;
  version?: BrowserUseVersion;
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
  maxFailures?: number;
  initialActions?: Array<Record<string, Record<string, any>>>;
  sensitiveData?: Record<string, string>;
  messageContext?: string;
  outputModelSchema?: z.ZodSchema | object;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: BrowserUseApiKeys;
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

// ===== 0.7.10-specific response models =====

export interface BrowserUseAgentOutputV0710 {
  thinking?: string | null;
  evaluation_previous_goal?: string | null;
  memory?: string | null;
  next_goal?: string | null;
  action: Array<Record<string, unknown>>;
}

export interface BrowserUseActionResultV0710 {
  is_done?: boolean | null;
  success?: boolean | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  attachments?: string[] | null;
  long_term_memory?: string | null;
  extracted_content?: string | null;
  include_extracted_content_only_once?: boolean | null;
  include_in_memory?: boolean | null;
}

export interface BrowserUseBrowserStateHistoryV0710 {
  url: string;
  title: string;
  tabs: Array<Record<string, unknown>>;
  interacted_element: Array<Record<string, unknown> | null>;
}

export interface BrowserUseStepMetadataV0710 {
  step_start_time: number;
  step_end_time: number;
  step_number: number;
}

export interface BrowserUseAgentHistoryV0710 {
  model_output: BrowserUseAgentOutputV0710 | null;
  result: BrowserUseActionResultV0710[];
  state: BrowserUseBrowserStateHistoryV0710;
  metadata?: BrowserUseStepMetadataV0710 | null;
}

// ===== latest response models =====

export type BrowserUseAgentHistoryLatest = Record<string, unknown>;

export type BrowserUseStep =
  | BrowserUseAgentHistory
  | BrowserUseAgentHistoryV0710
  | BrowserUseAgentHistoryLatest;

export interface BrowserUseTaskData {
  steps: BrowserUseStep[];
  finalResult: string | null;
}

export interface BrowserUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface BrowserUseTaskResponse {
  jobId: string;
  status: BrowserUseTaskStatus;
  metadata?: BrowserUseTaskMetadata | null;
  data?: BrowserUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
