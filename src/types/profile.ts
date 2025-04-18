export interface CreateProfileParams {
  name?: string;
}

export interface CreateProfileResponse {
  id: string;
  name: string | null;
}

export interface ProfileResponse {
  id: string;
  name: string | null;
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
