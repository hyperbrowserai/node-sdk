import {
  dockerBuildContextFingerprint,
  DockerBuildContextChangedError,
  imageBuildName,
  dockerImageDigest,
  DockerCommandError,
} from "./image-builds";
export {
  dockerBuildContextFingerprint,
  DockerBuildContextChangedError,
  imageBuildName,
  dockerImageDigest,
  DockerCommandError,
};
export type {
  DockerBuildContextOptions,
  ImageBuildNameOptions,
  ImageBuildSource,
} from "./image-builds";
import { HyperbrowserClient, HyperbrowserError } from "./client";

// Export HyperbrowserClient as Hyperbrowser for named imports
export const Hyperbrowser = HyperbrowserClient;
// Add a type alias for Hyperbrowser
export type Hyperbrowser = HyperbrowserClient;
export { HyperbrowserClient, HyperbrowserError };
export default HyperbrowserClient;

// For CommonJS compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = HyperbrowserClient;
  module.exports.Hyperbrowser = HyperbrowserClient;
  module.exports.HyperbrowserClient = HyperbrowserClient;
  module.exports.HyperbrowserError = HyperbrowserError;
  module.exports.dockerBuildContextFingerprint = dockerBuildContextFingerprint;
  module.exports.DockerBuildContextChangedError = DockerBuildContextChangedError;
  module.exports.imageBuildName = imageBuildName;
  module.exports.dockerImageDigest = dockerImageDigest;
  module.exports.DockerCommandError = DockerCommandError;
  module.exports.default = HyperbrowserClient;
}
