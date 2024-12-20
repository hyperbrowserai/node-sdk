import {
  BasicResponse,
  CreateSessionParams,
  SessionDetail,
  SessionListParams,
  SessionListResponse,
} from "../types/session";
import { BaseService } from "./base";
import { HyperbrowserError } from "../client";
export class SessionsService extends BaseService {
  /**
   * Create a new browser session
   * @param params Configuration parameters for the new session
   */
  async create(params?: CreateSessionParams): Promise<SessionDetail> {
    try {
      return await this.request<SessionDetail>("/session", {
        method: "POST",
        body: params ? JSON.stringify(params) : undefined,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        "Failed to create session",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get details of an existing session
   * @param id The ID of the session to get
   */
  async get(id: string): Promise<SessionDetail> {
    try {
      return await this.request<SessionDetail>(`/session/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get session ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stop a running session
   * @param id The ID of the session to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/session/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to stop session ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * List all sessions with optional filtering
   * @param params Optional parameters to filter the sessions
   */
  async list(params: SessionListParams = {}): Promise<SessionListResponse> {
    try {
      return await this.request<SessionListResponse>("/sessions", undefined, {
        status: params.status,
        page: params.page,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        "Failed to list sessions",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }
}
