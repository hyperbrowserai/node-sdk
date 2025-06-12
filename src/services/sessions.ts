import { promises as fs, Stats, createReadStream, ReadStream } from "fs";
import * as path from "path";
import FormData from "form-data";
import { RequestInit } from "node-fetch";
import {
  BasicResponse,
  CreateSessionParams,
  GetSessionDownloadsUrlResponse,
  GetSessionRecordingUrlResponse,
  GetSessionVideoRecordingUrlResponse,
  SessionDetail,
  SessionListParams,
  SessionListResponse,
  SessionRecording,
  UploadFileOptions,
  UploadFileResponse,
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
   * Get the video recording URL of a session
   * @param id The ID of the session to get the video recording URL from
   */
  async getVideoRecordingURL(id: string): Promise<GetSessionVideoRecordingUrlResponse> {
    try {
      return await this.request<GetSessionVideoRecordingUrlResponse>(
        `/session/${id}/video-recording-url`
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get video recording url for session ${id}`, undefined);
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

  /**
   * Upload a file to the session
   * @param id The ID of the session to upload the file to
   * @param fileOptions Options for uploading a file
   * @param fileOptions.fileInput File path string, ReadStream, or Buffer containing the file data
   * @param fileOptions.fileName Optional name to use for the uploaded file. Required when fileInput is a Buffer
   */
  async uploadFile(id: string, fileOptions: UploadFileOptions): Promise<UploadFileResponse> {
    const { fileInput, fileName } = fileOptions;

    try {
      let fetchOptions: RequestInit;

      if (typeof fileInput === "string") {
        let stats: Stats;
        try {
          stats = await fs.stat(fileInput);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new HyperbrowserError(`File not found: ${fileInput}`, undefined);
          }
          if (error.code === "EACCES") {
            throw new HyperbrowserError(
              `Permission denied accessing file: ${fileInput}`,
              undefined
            );
          }
          throw new HyperbrowserError(
            `Failed to access file ${fileInput}: ${error.message}`,
            undefined
          );
        }

        if (!stats.isFile()) {
          throw new HyperbrowserError(`Path is not a file: ${fileInput}`, undefined);
        }

        const formData = new FormData();
        const fileStream = createReadStream(fileInput);
        const fileBaseName = fileName || path.basename(fileInput);

        fileStream.on("error", (error) => {
          throw new HyperbrowserError(
            `Failed to read file ${fileInput}: ${error.message}`,
            undefined
          );
        });

        formData.append("file", fileStream, {
          filename: fileBaseName,
        });

        fetchOptions = {
          method: "POST",
          body: formData,
          headers: formData.getHeaders(),
        };
      } else if (this.isReadableStream(fileInput)) {
        const formData = new FormData();

        let tmpFileName = fileName || `file-${Date.now()}`;
        if (fileInput.path && typeof fileInput.path === "string" && !fileName) {
          tmpFileName = path.basename(fileInput.path);
        }

        formData.append("file", fileInput, {
          filename: tmpFileName,
        });

        fetchOptions = {
          method: "POST",
          body: formData,
          headers: formData.getHeaders(),
        };
      } else if (Buffer.isBuffer(fileInput)) {
        if (!fileName) {
          throw new HyperbrowserError("fileName is required when uploading Buffer data", undefined);
        }

        const formData = new FormData();
        formData.append("file", fileInput, {
          filename: fileName,
        });

        fetchOptions = {
          method: "POST",
          body: formData,
          headers: formData.getHeaders(),
        };
      } else {
        throw new HyperbrowserError(
          "Unsupported file input type. Please provide a file path string, ReadStream, or Buffer.",
          undefined
        );
      }

      return await this.request<UploadFileResponse>(`/session/${id}/uploads`, fetchOptions);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      throw new HyperbrowserError(`Failed to upload file for session ${id}: ${error}`, undefined);
    }
  }

  /**
   * Helper method to check if input is a readable stream
   */
  private isReadableStream(obj: any): obj is ReadStream {
    return (
      obj &&
      typeof obj === "object" &&
      typeof obj.read === "function" &&
      typeof obj.on === "function" &&
      obj.readable !== false
    );
  }
}
