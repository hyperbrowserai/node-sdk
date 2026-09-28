/** Public, offline image identity helpers. */
export {
  dockerBuildContextFingerprint,
  DockerBuildContextChangedError,
} from "./sandbox/image-build/context";
export type { DockerBuildContextOptions } from "./sandbox/image-build/context";
export { imageBuildName } from "./sandbox/image-build/resolution";
export type { ImageBuildNameOptions, ImageBuildSource } from "./sandbox/image-build/resolution";
export { dockerImageDigest, DockerCommandError } from "./sandbox/image-build/docker-image";
