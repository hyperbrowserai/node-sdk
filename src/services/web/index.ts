import { toJSONSchema } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { BaseService } from "../base";
import { HyperbrowserError } from "../../client";
import { FetchParams, FetchResponse } from "../../types/web/fetch";
import { WebSearchParams, WebSearchResponse } from "../../types/web/search";
import {
  BatchFetchJobResponse,
  BatchFetchJobStatusResponse,
  GetBatchFetchJobParams,
  StartBatchFetchJobParams,
  StartBatchFetchJobResponse,
} from "../../types/web/batch-fetch";
import { FetchOutputJson } from "../../types/web/common";
import { isZodSchema, sleep } from "../../utils";
import { POLLING_ATTEMPTS } from "../../types/constants";

export class BatchFetchService extends BaseService {
  /**
   * Start a new batch fetch job
   * @param params The parameters for the batch fetch job
   */
  async start(params: StartBatchFetchJobParams): Promise<StartBatchFetchJobResponse> {
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

      return await this.request<StartBatchFetchJobResponse>("/web/batch-fetch", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start batch fetch job", undefined);
    }
  }

  /**
   * Get the status of a batch fetch job
   * @param id The ID of the batch fetch job to get
   */
  async getStatus(id: string): Promise<BatchFetchJobStatusResponse> {
    try {
      return await this.request<BatchFetchJobStatusResponse>(`/web/batch-fetch/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get batch fetch job ${id} status`, undefined);
    }
  }

  /**
   * Get the details of a batch fetch job
   * @param id The ID of the batch fetch job to get
   * @param params Optional parameters to filter the batch fetch job
   */
  async get(id: string, params?: GetBatchFetchJobParams): Promise<BatchFetchJobResponse> {
    try {
      return await this.request<BatchFetchJobResponse>(`/web/batch-fetch/${id}`, undefined, {
        page: params?.page,
        batchSize: params?.batchSize,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get batch fetch job ${id}`, undefined);
    }
  }

  /**
   * Start a batch fetch job and wait for it to complete
   * @param params The parameters for the batch fetch job
   * @param returnAllPages Whether to return all pages in the batch fetch job response
   */
  async startAndWait(
    params: StartBatchFetchJobParams,
    returnAllPages: boolean = true
  ): Promise<BatchFetchJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start batch fetch job", undefined);
    }

    let failures = 0;
    let jobStatus: BatchFetchJobResponse["status"] = "pending";
    while (true) {
      try {
        const { status } = await this.getStatus(jobId);
        if (status === "completed" || status === "failed") {
          jobStatus = status;
          break;
        }
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to poll batch fetch job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }

    failures = 0;
    if (!returnAllPages) {
      while (true) {
        try {
          return await this.get(jobId);
        } catch (error) {
          failures++;
          if (failures >= POLLING_ATTEMPTS) {
            throw new HyperbrowserError(
              `Failed to get batch fetch job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
            );
          }
        }
        await sleep(500);
      }
    }

    failures = 0;

    const jobResponse: BatchFetchJobResponse = {
      jobId,
      status: jobStatus,
      data: [],
      currentPageBatch: 0,
      totalPageBatches: 0,
      totalPages: 0,
      batchSize: 100,
    };
    let firstCheck = true;

    while (firstCheck || jobResponse.currentPageBatch < jobResponse.totalPageBatches) {
      try {
        const tmpJobResponse = await this.get(jobId, {
          page: jobResponse.currentPageBatch + 1,
          batchSize: 100,
        });
        if (tmpJobResponse.data) {
          jobResponse.data?.push(...tmpJobResponse.data);
        }
        jobResponse.currentPageBatch = tmpJobResponse.currentPageBatch;
        jobResponse.totalPages = tmpJobResponse.totalPages;
        jobResponse.totalPageBatches = tmpJobResponse.totalPageBatches;
        jobResponse.batchSize = tmpJobResponse.batchSize;
        jobResponse.error = tmpJobResponse.error;
        failures = 0;
        firstCheck = false;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to get batch page ${jobResponse.currentPageBatch} for job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(500);
    }
    return jobResponse;
  }
}

export class WebService extends BaseService {
  public readonly batchFetch: BatchFetchService;

  constructor(apiKey: string, baseUrl: string, timeout: number) {
    super(apiKey, baseUrl, timeout);
    this.batchFetch = new BatchFetchService(apiKey, baseUrl, timeout);
  }
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
