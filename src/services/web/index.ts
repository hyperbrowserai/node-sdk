import { toJSONSchema } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { BaseService } from "../base";
import { HyperbrowserError } from "../../client";
import { FetchParams, FetchResponse } from "../../types/web/fetch";
import { WebSearchParams, WebSearchResponse } from "../../types/web/search";
import { FetchOutputJson } from "../../types/web/common";
import { isZodSchema } from "../../utils";

export class WebService extends BaseService {
  /**
   * Fetch a URL and extract content
   * @param params The parameters for the fetch request
   */
  async fetch(params: FetchParams): Promise<FetchResponse> {
    try {
      // Handle JSON schema serialization if needed (similar to Python SDK)
      if (params.outputs?.formats) {
        for (const output of params.outputs.formats) {
          if (typeof output === "object" && "type" in output && output.type === "json") {
            const jsonOutput = output as FetchOutputJson;
            if (jsonOutput.schema) {
              if (isZodSchema(jsonOutput.schema)) {
                try {
                  output.schema = toJSONSchema(jsonOutput.schema);
                } catch {
                  output.schema = zodToJsonSchema(jsonOutput.schema as any);
                }
              }
            }
          }
        }
      }

      return await this.request<FetchResponse>("/web/fetch", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to fetch URL", undefined);
    }
  }

  /**
   * Search the web
   * @param params The parameters for the search request
   */
  async search(params: WebSearchParams): Promise<WebSearchResponse> {
    try {
      return await this.request<WebSearchResponse>("/web/search", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to search web", undefined);
    }
  }
}
