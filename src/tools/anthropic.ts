import { CRAWL_SCHEMA, SCRAPE_SCHEMA } from "./schema";

export interface CacheControlEphemeral {
  type: "ephemeral";
}

export interface InputSchema {
  type: "object";

  properties?: unknown | null;
  [k: string]: unknown;
}

export interface Tool {
  /**
   * [JSON schema](https://json-schema.org/) for this tool's input.
   *
   * This defines the shape of the `input` that your tool accepts and that the model
   * will produce.
   */
  input_schema: InputSchema;

  /**
   * Name of the tool.
   *
   * This is how the tool will be called by the model and in tool_use blocks.
   */
  name: string;

  cache_control?: CacheControlEphemeral | null;

  /**
   * Description of what this tool does.
   *
   * Tool descriptions should be as detailed as possible. The more information that
   * the model has about what the tool is and how to use it, the better it will
   * perform. You can use natural language descriptions to reinforce important
   * aspects of the tool input JSON schema.
   */
  description?: string;
}

export const SCRAPE_TOOL_ANTHROPIC: Tool = {
  input_schema: SCRAPE_SCHEMA,
  name: "scrape_webpage",
  description: "Scrape content from a webpage and return the content in markdown format",
};

export const CRAWL_TOOL_ANTHROPIC: Tool = {
  input_schema: CRAWL_SCHEMA,
  name: "crawl_website",
  description: "Crawl a website and return the content in markdown format",
};
