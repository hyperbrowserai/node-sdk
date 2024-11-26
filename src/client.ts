import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";
import { SessionDetail, SessionListParams, SessionListResponse } from "./types/session";

export class HyperbrowserError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: Response
  ) {
    super(message);
    this.name = "HyperbrowserError";
  }
}

export class HyperbrowserClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: HyperbrowserConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://app.hyperbrowser.ai";

    if (!this.apiKey) {
      throw new Error("API key is required");
    }
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new HyperbrowserError(
        `HTTP error! status: ${response.status}`,
        response.status,
        response
      );
    }

    // Handle empty responses (like for stop session)
    if (response.headers.get("content-length") === "0") {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new HyperbrowserError("Failed to parse JSON response", response.status, response);
    }
  }

  /**
   * Create a new browser session
   */
  async createSession(): Promise<SessionDetail> {
    return this.request<SessionDetail>("/session", { method: "POST" });
  }

  /**
   * Get details of an existing session
   */
  async getSession(id: string): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/session/${id}`);
  }

  /**
   * Stop a running session
   * @returns true if the session was successfully stopped
   */
  async stopSession(id: string): Promise<boolean> {
    try {
      await this.request(`/session/${id}/stop`, { method: "PUT" });
      return true;
    } catch (error) {
      if (error instanceof HyperbrowserError && error.statusCode && error.statusCode > 300) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all sessions with optional filtering
   */
  async listSessions(params: SessionListParams = {}): Promise<SessionListResponse> {
    return this.request<SessionListResponse>("/sessions", undefined, {
      status: params.status,
      page: params.page,
    });
  }
}
