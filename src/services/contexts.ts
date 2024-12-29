import { BaseService } from "./base";
import { ContextResponse, CreateContextResponse } from "../types/context";
import { HyperbrowserError } from "../client";
import { BasicResponse } from "../types";

export class ContextsService extends BaseService {
  /**
   * Create a new context
   */
  async create(): Promise<CreateContextResponse> {
    try {
      return await this.request<CreateContextResponse>("/context", {
        method: "POST",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create context", undefined);
    }
  }

  /**
   * Get details of an existing context
   * @param id The ID of the context to get
   */
  async get(id: string): Promise<ContextResponse> {
    try {
      return await this.request<ContextResponse>(`/context/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get context ${id}`, undefined);
    }
  }

  /**
   * Delete an existing context
   * @param id The ID of the context to delete
   */
  async delete(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/context/${id}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete context ${id}`, undefined);
    }
  }
}
