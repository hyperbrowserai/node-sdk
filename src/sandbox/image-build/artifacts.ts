import { rmSync } from "fs";
import { SandboxImageBuildInputFormat, SandboxImageInit } from "../../types/sandbox";

export const IMAGE_BUILD_INPUT_FORMAT: SandboxImageBuildInputFormat = "rootfs_export_tar_gz";
export const CONTEXT_MANIFEST_INPUT_FORMAT: SandboxImageBuildInputFormat =
  "dockerfile_context_manifest_v1";
export const DOCKER_IMAGE_MANIFEST_INPUT_FORMAT: SandboxImageBuildInputFormat =
  "docker_image_manifest_v1";
export const IMAGE_BUILD_SOURCE_PLATFORM = "linux/amd64";

export interface DockerImageBuildArtifact {
  path: string;
  sha256Hex: string;
  sizeBytes: number;
  inputFormat: SandboxImageBuildInputFormat;
  sourcePlatform: string;
  imageConfigUser: string;
  imageInit?: SandboxImageInit;
}

export const removeArtifact = (artifact: DockerImageBuildArtifact): void => {
  rmSync(artifact.path, { force: true });
};

export const removeWorkspace = (workspace: string): void => {
  rmSync(workspace, { recursive: true, force: true });
};
