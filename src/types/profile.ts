export interface CreateProfileParams {
  name?: string;
}

export interface CreateProfileResponse {
  id: string;
}

export interface ProfileResponse {
  id: string;
  teamId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileListParams {
  name?: string;
  page?: number;
  limit?: number;
}

export interface ProfileListResponse {
  profiles: ProfileResponse[];
  totalCount: number;
  page: number;
  perPage: number;
}
