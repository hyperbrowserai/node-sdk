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
  module.exports.default = HyperbrowserClient;
}
