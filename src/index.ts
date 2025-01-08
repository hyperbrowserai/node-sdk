import { HyperbrowserClient } from "./client";
import {
  CRAWL_TOOL_OPENAI,
  CRAWL_TOOL_ANTHROPIC,
  SCRAPE_TOOL_OPENAI,
  SCRAPE_TOOL_ANTHROPIC,
} from "./tools";
export { HyperbrowserError } from "./client";

export * from "./types";
export * from "./tools";

// Export HyperbrowserClient as Hyperbrowser for named imports
export const Hyperbrowser = HyperbrowserClient;
export default HyperbrowserClient;

// For CommonJS compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = HyperbrowserClient;
  module.exports.Hyperbrowser = HyperbrowserClient;
  module.exports.HyperbrowserClient = HyperbrowserClient;
  module.exports.default = HyperbrowserClient;

  module.exports.CRAWL_TOOL_OPENAI = CRAWL_TOOL_OPENAI;
  module.exports.CRAWL_TOOL_ANTHROPIC = CRAWL_TOOL_ANTHROPIC;
  module.exports.SCRAPE_TOOL_OPENAI = SCRAPE_TOOL_OPENAI;
  module.exports.SCRAPE_TOOL_ANTHROPIC = SCRAPE_TOOL_ANTHROPIC;
}
