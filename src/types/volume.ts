export interface CreateVolumeParams {
  name: string;
}

export interface Volume {
  id: string;
  name: string;
  size?: number;
  transferAmount?: number;
}

export interface VolumeListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export interface VolumeListResponse {
  volumes: Volume[];
  totalCount: number;
  page: number;
  perPage: number;
}
