import { BaseService } from "./base";
import {
  WebMCPInvocation,
  WebMCPInvokeParams,
  WebMCPInvokeResult,
  WebMCPResultParams,
  WebMCPStartParams,
  WebMCPToolsResponse,
} from "../types/webmcp";

function seconds(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function invocationBody(params: WebMCPInvokeParams): string {
  if (typeof params.toolRef !== "string" || !params.toolRef.trim()) {
    throw new TypeError("toolRef must be a non-empty string from listTools");
  }
  if (
    params.input !== undefined &&
    (params.input === null || typeof params.input !== "object" || Array.isArray(params.input))
  ) {
    throw new TypeError("input must be a JSON object");
  }
  return JSON.stringify(params);
}

/** Page tools for sessions created with enableWebMcp: true. */
export class WebMCPService extends BaseService {
  private path(sessionId: string): string {
    return `/session/${encodeURIComponent(sessionId)}/webmcp`;
  }

  /** Discover current tools across the session's tabs and frames. */
  async listTools(sessionId: string): Promise<WebMCPToolsResponse> {
    return this.request(`${this.path(sessionId)}/tools`, {
      timeout: Math.max(this.timeout, 40_000),
    });
  }

  /** Invoke once. Transport failures never cause an automatic retry. */
  async invoke(sessionId: string, params: WebMCPInvokeParams): Promise<WebMCPInvokeResult> {
    const timeout = seconds(params.timeoutSeconds ?? 60, 1, 120, "timeoutSeconds");
    return this.request(`${this.path(sessionId)}/invoke`, {
      method: "POST",
      body: invocationBody(params),
      timeout: Math.max(this.timeout, (timeout + 35) * 1000),
    });
  }

  /** Start once and return a handle. A lost response may mean the tool already ran. */
  async start(sessionId: string, params: WebMCPStartParams): Promise<WebMCPInvocation> {
    seconds(params.timeoutSeconds ?? 300, 1, 3600, "timeoutSeconds");
    return this.request(`${this.path(sessionId)}/invocations`, {
      method: "POST",
      body: invocationBody(params),
      timeout: Math.max(this.timeout, 40_000),
    });
  }

  /** Read or long-poll a handle. Pending responses do not cancel or restart the tool. */
  async getResult(
    sessionId: string,
    invocationId: string,
    params: WebMCPResultParams = {}
  ): Promise<WebMCPInvocation> {
    const wait = seconds(params.waitSeconds ?? 0, 0, 30, "waitSeconds");
    return this.request(
      `${this.path(sessionId)}/invocations/${encodeURIComponent(invocationId)}`,
      { timeout: Math.max(this.timeout, (wait + 20) * 1000) },
      { waitSeconds: params.waitSeconds }
    );
  }

  /** Request cancellation; completion can win the race. Read getResult for the outcome. */
  async cancel(sessionId: string, invocationId: string): Promise<WebMCPInvocation> {
    return this.request(
      `${this.path(sessionId)}/invocations/${encodeURIComponent(invocationId)}/cancel`,
      { method: "POST", timeout: Math.max(this.timeout, 20_000) }
    );
  }
}
