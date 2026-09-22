import { JevComputerUseLlm, JevComputerUseTaskStatus, JevTextLlm } from "../constants";
import { CreateSessionParams } from "../session";

export interface JevComputerUseApiKeys {
  jev?: string;
  google?: string;
}

export interface StartJevComputerUseTaskParams {
  task: string;
  llm?: JevComputerUseLlm;
  textLlm?: JevTextLlm;
  sessionId?: string;
  maxFailures?: number;
  maxSteps?: number;
  keepBrowserOpen?: boolean;
  sessionOptions?: CreateSessionParams;
  useCustomApiKeys?: boolean;
  apiKeys?: JevComputerUseApiKeys;
}

export interface StartJevComputerUseTaskResponse {
  jobId: string;
  liveUrl: string | null;
}

export interface JevComputerUseTaskStatusResponse {
  status: JevComputerUseTaskStatus;
}

export interface JevComputerUseAction {
  kind: string;
  target?: string;
  option?: string;
}

export interface JevComputerUseStepResponse {
  step: number;
  action: JevComputerUseAction;
  url: string;
  value?: string;
  title?: string;
  pageText?: string;
  targetDescription?: string;
  confidence?: number | null;
  error?: string;
  errorKind?: string;
  pageChanged?: boolean | null;
  outcome?: string;
  after?: string;
  beforeTab?: string;
  afterTab?: string;
  beforeObservation?: number;
  afterObservation?: number;
}

export interface JevComputerUseTaskData {
  steps: JevComputerUseStepResponse[];
  finalResult: string | null;
  reachedMaxSteps?: boolean;
  finalUrl?: string | null;
  warnings?: string[];
}

export interface JevComputerUseTaskMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  numTaskStepsCompleted?: number | null;
}

export interface JevComputerUseTaskResponse {
  jobId: string;
  status: JevComputerUseTaskStatus;
  metadata?: JevComputerUseTaskMetadata | null;
  data?: JevComputerUseTaskData | null;
  error?: string | null;
  liveUrl: string | null;
}
