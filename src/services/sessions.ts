import {
  BasicResponse,
  CreateSessionParams,
  GetSessionDownloadsUrlResponse,
  GetSessionRecordingUrlResponse,
  SessionDetail,
  SessionListParams,
  SessionListResponse,
  SessionRecording,
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
      throw new HyperbrowserError("Failed to create session", undefined);
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
      throw new HyperbrowserError(`Failed to get session ${id}`, undefined);
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
      throw new HyperbrowserError(`Failed to stop session ${id}`, undefined);
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
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sessions", undefined);
    }
  }

  /**
   * Get the recording of a session
   * @param id The ID of the session to get the recording from
   */
  async getRecording(id: string): Promise<SessionRecording[]> {
    try {
      return await this.request<SessionRecording[]>(`/session/${id}/recording`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get recording for session ${id}`, undefined);
    }
  }

  /**
   * Get the recording URL of a session
   * @param id The ID of the session to get the recording URL from
   */
  async getRecordingURL(id: string): Promise<GetSessionRecordingUrlResponse> {
    try {
      return await this.request<GetSessionRecordingUrlResponse>(`/session/${id}/recording-url`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get recording url for session ${id}`, undefined);
    }
  }

  /**
   * Get the downloads URL of a session
   * @param id The ID of the session to get the downloads URL from
   */
  async getDownloadsURL(id: string): Promise<GetSessionDownloadsUrlResponse> {
    try {
      return await this.request<GetSessionDownloadsUrlResponse>(`/session/${id}/downloads-url`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get downloads url for session ${id}`, undefined);
    }
  }
}
