import { toJSONSchema } from "zod";
import { FetchResponse, FetchParams } from "../../types/web/fetch";
import { BaseService } from "../base";
import { isZodSchema } from "../../utils";
import { HyperbrowserError } from "../../client";
import { BatchFetchService } from "./batch-fetch";
import { WebCrawlService } from "./crawl";
import { DeepFetchService } from "./deep-fetch";

export class WebService extends BaseService {
  public readonly batchFetch: BatchFetchService;
  public readonly crawl: WebCrawlService;
  public readonly deepFetch: DeepFetchService;

  constructor(apiKey: string, baseUrl: string, timeout: number) {
    super(apiKey, baseUrl, timeout);
    this.batchFetch = new BatchFetchService(apiKey, baseUrl, timeout);
    this.crawl = new WebCrawlService(apiKey, baseUrl, timeout);
    this.deepFetch = new DeepFetchService(apiKey, baseUrl, timeout);
  }

  /**
   * Execute a fetch
   * @param params The parameters for the fetch
   */
  async fetch(params: FetchParams): Promise<FetchResponse> {
    try {
      const jsonOutput = params.outputs?.find(
        (output) => typeof output === "object" && output.type === "json"
      );
      if (jsonOutput && jsonOutput.options?.schema) {
        if (isZodSchema(jsonOutput.options.schema)) {
          jsonOutput.options.schema = toJSONSchema(jsonOutput.options.schema);
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
      throw new HyperbrowserError("Failed to execute fetch", undefined);
    }
  }
}
