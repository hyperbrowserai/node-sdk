import { HyperbrowserError } from "../client";
import { CreateVolumeParams, Volume, VolumeListParams, VolumeListResponse } from "../types/volume";
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
      const query = {
        page: params.page,
        limit: params.limit,
        search: params.search,
      };
      const hasQuery = Object.values(query).some((value) => value !== undefined);
      return hasQuery
        ? await this.request<VolumeListResponse>("/volume", undefined, query)
        : await this.request<VolumeListResponse>("/volume");
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
}
