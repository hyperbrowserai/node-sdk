export interface CreateVolumeParams {
  name: string;
}

export interface Volume {
  id: string;
  name: string;
  size?: number | null;
  transferAmount?: number | null;
}

export interface VolumeListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export interface VolumeListResponse {
  volumes: Volume[];
  totalCount?: number | null;
  page?: number | null;
  perPage?: number | null;
}

export interface VolumeDeleteResult {
  deleted: boolean;
  id?: string | null;
  name?: string | null;
}
