import {
  HyperbrowserClient,
  HyperbrowserError,
  type HyperbrowserErrorOptions,
  type HyperbrowserService,
} from "./client";
import { SandboxesService, SandboxHandle } from "./services/sandboxes";
import {
  SandboxProcessHandle,
  SandboxProcessesApi,
  SandboxFilesApi,
  SandboxFileWatchHandle,
  SandboxTerminalApi,
  SandboxTerminalConnection,
  SandboxTerminalHandle,
} from "./runtime";

export {
  HyperbrowserError,
  HyperbrowserErrorOptions,
  HyperbrowserService,
};
export { SandboxesService, SandboxHandle };
export {
  SandboxProcessHandle,
  SandboxProcessesApi,
  SandboxFilesApi,
  SandboxFileWatchHandle,
  SandboxTerminalApi,
  SandboxTerminalConnection,
  SandboxTerminalHandle,
};

// Export HyperbrowserClient as Hyperbrowser for named imports
export const Hyperbrowser = HyperbrowserClient;
// Add a type alias for Hyperbrowser
export type Hyperbrowser = HyperbrowserClient;
export default HyperbrowserClient;

// For CommonJS compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = HyperbrowserClient;
  module.exports.Hyperbrowser = HyperbrowserClient;
  module.exports.HyperbrowserClient = HyperbrowserClient;
  module.exports.HyperbrowserError = HyperbrowserError;
  module.exports.SandboxesService = SandboxesService;
  module.exports.SandboxHandle = SandboxHandle;
  module.exports.SandboxProcessHandle = SandboxProcessHandle;
  module.exports.SandboxProcessesApi = SandboxProcessesApi;
  module.exports.SandboxFilesApi = SandboxFilesApi;
  module.exports.SandboxFileWatchHandle = SandboxFileWatchHandle;
  module.exports.SandboxTerminalApi = SandboxTerminalApi;
  module.exports.SandboxTerminalConnection = SandboxTerminalConnection;
  module.exports.SandboxTerminalHandle = SandboxTerminalHandle;
  module.exports.default = HyperbrowserClient;
}
