import { TaskLlm, BrowserUseTaskStatus } from "../constants";
import { CreateSessionParams } from "../session";

export type TaskStatus = BrowserUseTaskStatus;

export interface AgentTaskListParams {
  task?: string;
  page?: number;
  limit?: number;
}

export interface AgentTaskSummary {
  id: string;
  createdAt: string;
  status: TaskStatus;
  task: string;
}

export interface AgentTaskListResponse {
  tasks: AgentTaskSummary[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface StartTaskParams {
  task: string;
  llm?: TaskLlm;
  sessionId?: string;
  validateOutput?: boolean;
  useVision?: boolean;
  useVisionForPlanner?: boolean;
  maxActionsPerStep?: number;
  maxInputTokens?: number;
  plannerLlm?: TaskLlm;
  pageExtractionLlm?: TaskLlm;
  plannerInterval?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
}

export interface StartTaskResponse {
  jobId: string;
}

export interface TaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface TaskData {
  steps?: unknown[];
  finalResult?: string | null;
  [key: string]: unknown;
}

export interface TaskStatusResponse {
  status: TaskStatus;
}

export interface TaskResponse {
  jobId: string;
  status: TaskStatus;
  metadata?: TaskMetadata | null;
  data?: TaskData | null;
  error?: string | null;
}
