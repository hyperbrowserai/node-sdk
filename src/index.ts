import { HyperbrowserClient } from "./client";
export * from "./types";
export { HyperbrowserError } from "./client";

// Export HyperbrowserClient as Hyperbrowser for named imports
export const Hyperbrowser = HyperbrowserClient;
export default HyperbrowserClient;

// For CommonJS compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = HyperbrowserClient;
  module.exports.Hyperbrowser = HyperbrowserClient;
  module.exports.HyperbrowserClient = HyperbrowserClient;
  module.exports.default = HyperbrowserClient;
}
