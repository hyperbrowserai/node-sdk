export { HyperbrowserClient as default } from "./client";
export * from "./types";
export { HyperbrowserError } from "./client";

module.exports = require("./client").HyperbrowserClient;
module.exports.default = module.exports;
