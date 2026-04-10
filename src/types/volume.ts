export interface CreateVolumeParams {
  name: string;
}

export interface Volume {
  id: string;
  name: string;
  size?: number;
  transferAmount?: number;
}

export interface VolumeListResponse {
  volumes: Volume[];
}
