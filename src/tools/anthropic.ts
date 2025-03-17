import {
  BROWSER_USE_SCHEMA,
  CRAWL_SCHEMA,
  EXTRACT_SCHEMA,
  SCRAPE_SCHEMA,
  SCREENSHOT_SCHEMA,
} from "./schema";

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

export const SCREENSHOT_TOOL_ANTHROPIC: Tool = {
  name: "screenshot_webpage",
  description:
    "Take a screenshot of a webpage and return the screenshot in screenshot format as a url",
  input_schema: SCREENSHOT_SCHEMA,
};

export const CRAWL_TOOL_ANTHROPIC: Tool = {
  input_schema: CRAWL_SCHEMA,
  name: "crawl_website",
  description: "Crawl a website and return the content in markdown format",
};

export const EXTRACT_TOOL_ANTHROPIC: Tool = {
  input_schema: EXTRACT_SCHEMA,
  name: "extract_data",
  description:
    "Extract data in a structured format from multiple URLs in a single function call. IMPORTANT: When information must be gathered from multiple sources (such as comparing items, researching topics across sites, or answering questions that span multiple webpages), ALWAYS include all relevant URLs in ONE function call. This enables comprehensive answers with cross-referenced information. Returns data as a json string.",
};

export const BROWSER_USE_TOOL_ANTHROPIC: Tool = {
  input_schema: BROWSER_USE_SCHEMA,
  name: "browser_use",
  description: "Have an AI agent use a browser to perform a task on the web.",
};
