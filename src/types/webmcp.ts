/** Page-provided hints; these are not browser-enforced guarantees. */
export interface WebMCPAnnotations {
  readOnly: boolean;
  untrustedContent: boolean;
  consequential: boolean;
  autosubmit: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}

export interface WebMCPFrame {
  id: string;
  url: string;
  isMainFrame: boolean;
}

export interface WebMCPSource {
  provider: "native" | "polyfill";
  tabId: string;
  pageUrl: string;
  pageTitle: string;
  frame: WebMCPFrame;
}

export interface WebMCPTool {
  /** Opaque reference to this document. Discover tools again after navigation. */
  toolRef: string;
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: WebMCPAnnotations;
  declarative: boolean;
  /** Native DOM node identifier, when available, in the source target/frame. */
  backendNodeId?: number;
  source: WebMCPSource;
}

export interface WebMCPToolsResponse {
  tools: WebMCPTool[];
  nativeSupported: boolean;
  truncated: boolean;
}

export interface WebMCPInvokeParams {
  toolRef: string;
  /** Page-defined keys are passed through unchanged. Defaults to {}. */
  input?: Record<string, unknown>;
  /** Execution deadline in seconds: 1–120, default 60. */
  timeoutSeconds?: number;
}

export interface WebMCPStartParams extends WebMCPInvokeParams {
  /** Execution deadline including human submission: 1–3600 seconds, default 300. */
  timeoutSeconds?: number;
}

export interface WebMCPResultParams {
  /** Wait 0–30 seconds, default 0. A pending response does not cancel the tool. */
  waitSeconds?: number;
}

export type WebMCPInvokeStatus = "completed" | "error" | "canceled" | "awaiting_submission";
export type WebMCPInvocationStatus = WebMCPInvokeStatus | "running" | "outcome_unknown";

export interface WebMCPInvokeResult {
  invocationId?: string;
  status: WebMCPInvokeStatus;
  output?: unknown;
  errorText?: string;
  outputBytes: number;
  outputTruncated?: boolean;
  outputPreview?: string;
  untrustedContent: boolean;
  durationMs: number;
}

export interface WebMCPInvocationError {
  code: string;
  message: string;
}

/** Session-local record; results expire and do not survive receiver restarts. */
export interface WebMCPInvocation {
  invocationId: string;
  toolRef: string;
  status: WebMCPInvocationStatus;
  cancellationRequested: boolean;
  createdAt: string;
  expiresAt?: string;
  result?: WebMCPInvokeResult;
  error?: WebMCPInvocationError;
}
