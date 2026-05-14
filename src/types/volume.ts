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
  page?: number;
  limit?: number;
  search?: string;
}

export interface VolumeListResponse {
  volumes: Volume[];
  totalCount: number;
  page: number;
  perPage: number;
}
