import { HyperbrowserError } from "../client";
import {
  CreateVolumeParams,
  Volume,
  VolumeDeleteResult,
  VolumeListParams,
  VolumeListResponse,
} from "../types/volume";
import { BaseService } from "./base";

export class VolumesService extends BaseService {
  /**
   * Create a new sandbox volume.
   */
  async create(params: CreateVolumeParams): Promise<Volume> {
    try {
      return await this.request<Volume>("/volume", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create volume", undefined);
    }
  }

  /**
   * List sandbox volumes for the current team.
   */
  async list(params: VolumeListParams = {}): Promise<VolumeListResponse> {
    try {
      return await this.request<VolumeListResponse>("/volume", undefined, {
        search: params.search,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list volumes", undefined);
    }
  }

  /**
   * Get a single sandbox volume.
   */
  async get(id: string): Promise<Volume> {
    try {
      return await this.request<Volume>(`/volume/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get volume ${id}`, undefined);
    }
  }

  /**
   * Delete a sandbox volume by id or name.
   */
  async delete(key: string): Promise<VolumeDeleteResult> {
    try {
      return await this.request<VolumeDeleteResult>(
        `/volume/${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete volume ${key}`, undefined);
    }
  }
}
