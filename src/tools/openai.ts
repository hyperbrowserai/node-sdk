import { CRAWL_SCHEMA, SCRAPE_SCHEMA } from "./schema";

export type FunctionParameters = Record<string, unknown>;

export interface FunctionDefinition {
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain
   * underscores and dashes, with a maximum length of 64.
   */
  name: string;

  /**
   * A description of what the function does, used by the model to choose when and
   * how to call the function.
   */
  description?: string;

  /**
   * The parameters the functions accepts, described as a JSON Schema object. See the
   * [guide](https://platform.openai.com/docs/guides/function-calling) for examples,
   * and the
   * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
   * documentation about the format.
   *
   * Omitting `parameters` defines a function with an empty parameter list.
   */
  parameters?: FunctionParameters;

  /**
   * Whether to enable strict schema adherence when generating the function call. If
   * set to true, the model will follow the exact schema defined in the `parameters`
   * field. Only a subset of JSON Schema is supported when `strict` is `true`. Learn
   * more about Structured Outputs in the
   * [function calling guide](docs/guides/function-calling).
   */
  strict?: boolean | null;
}

export interface ChatCompletionTool {
  function: FunctionDefinition;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: "function";
}

export const SCRAPE_TOOL_OPENAI: ChatCompletionTool = {
  type: "function",
  function: {
    name: "scrape_webpage",
    description: "Scrape content from a webpage and return the content in markdown format",
    parameters: SCRAPE_SCHEMA,
  },
};

export const CRAWL_TOOL_OPENAI: ChatCompletionTool = {
  type: "function",
  function: {
    name: "crawl_website",
    description: "Crawl a website and return the content in markdown format",
    parameters: CRAWL_SCHEMA,
  },
};