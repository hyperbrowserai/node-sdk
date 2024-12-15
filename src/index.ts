import { HyperbrowserClient as Hyperbrowser } from "./client";
export * from "./types";
export { HyperbrowserError } from "./client";

export { Hyperbrowser };
export default Hyperbrowser;

module.exports = require("./client").HyperbrowserClient;
module.exports.default = module.exports;
