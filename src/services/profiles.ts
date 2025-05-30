import { BaseService } from "./base";
import {
  CreateProfileParams,
  ProfileResponse,
  CreateProfileResponse,
  ProfileListParams,
  ProfileListResponse,
} from "../types/profile";
import { HyperbrowserError } from "../client";
import { BasicResponse } from "../types";

export class ProfilesService extends BaseService {
  /**
   * Create a new profile
   * @param params Configuration parameters for the new profile
   */
  async create(params?: CreateProfileParams): Promise<CreateProfileResponse> {
    try {
      return await this.request<CreateProfileResponse>("/profile", {
        method: "POST",
        body: params ? JSON.stringify(params) : undefined,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create profile", undefined);
    }
  }

  /**
   * Get details of an existing profile
   * @param id The ID of the profile to get
   */
  async get(id: string): Promise<ProfileResponse> {
    try {
      return await this.request<ProfileResponse>(`/profile/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get profile ${id}`, undefined);
    }
  }

  /**
   * Delete an existing profile
   * @param id The ID of the profile to delete
   */
  async delete(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/profile/${id}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete profile ${id}`, undefined);
    }
  }

  /**
   * List all profiles with optional pagination
   * @param params Optional parameters to filter the profiles
   */
  async list(params: ProfileListParams = {}): Promise<ProfileListResponse> {
    try {
      return await this.request<ProfileListResponse>("/profiles", undefined, {
        page: params.page,
        limit: params.limit,
        name: params.name,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list profiles", undefined);
    }
  }
}
