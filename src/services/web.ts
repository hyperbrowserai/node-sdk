import {
  FetchParams,
  FetchResponse,
  FetchOutputJson,
  FetchOutputLike,
  WebSearchParams,
  WebSearchResponse,
  StartBatchFetchJobParams,
  StartBatchFetchJobResponse,
  BatchFetchJobStatusResponse,
  GetBatchFetchJobParams,
  BatchFetchJobResponse,
} from "../types/web";
import { BatchFetchJobStatus, POLLING_ATTEMPTS } from "../types/constants";
import { BaseService } from "./base";
import { sleep } from "../utils";
import { HyperbrowserError } from "../client";

export class BatchFetchService extends BaseService {
  /**
   * Start a new batch fetch job
   * @param params The parameters for the batch fetch job
   */
  async start(params: StartBatchFetchJobParams): Promise<StartBatchFetchJobResponse> {
    try {
      const processedParams = this.processOutputParams(params);
      return await this.request<StartBatchFetchJobResponse>("/web/batch-fetch", {
        method: "POST",
        body: JSON.stringify(processedParams),
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
   * @param id The ID of the batch fetch job
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
   * @param id The ID of the batch fetch job
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
      throw new HyperbrowserError("Failed to start batch fetch job, could not get job ID");
    }

    let failures = 0;
    let jobStatus: BatchFetchJobStatus = "pending";
    while (true) {
      try {
        const { status } = await this.getStatus(jobId);
        if (status === "completed" || status === "failed") {
          jobStatus = status;
          break;
        }
        failures = 0;
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
        if (tmpJobResponse.error) {
          jobResponse.error = tmpJobResponse.error;
        }
        jobResponse.currentPageBatch = tmpJobResponse.currentPageBatch;
        jobResponse.totalPages = tmpJobResponse.totalPages;
        jobResponse.totalPageBatches = tmpJobResponse.totalPageBatches;
        jobResponse.batchSize = tmpJobResponse.batchSize;
        failures = 0;
        firstCheck = false;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to get batch page ${jobResponse.currentPageBatch + 1} for job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(500);
    }
    return jobResponse;
  }

  private processOutputParams<T extends { outputs?: FetchOutputLike[] }>(params: T): T {
    if (!params.outputs) {
      return params;
    }

    const processedOutputs = params.outputs.map((output) => {
      if (typeof output === "object" && output.type === "json") {
        const jsonOutput = output as FetchOutputJson;
        if (jsonOutput.options?.schema) {
          const schema = jsonOutput.options.schema as { toJsonSchema?: () => unknown };
          if (typeof schema.toJsonSchema === "function") {
            return {
              ...jsonOutput,
              options: {
                ...jsonOutput.options,
                schema: schema.toJsonSchema(),
              },
            };
          }
        }
      }
      return output;
    });

    return { ...params, outputs: processedOutputs };
  }
}

export class WebService extends BaseService {
  public readonly batchFetch: BatchFetchService;

  constructor(apiKey: string, baseUrl: string, timeout: number) {
    super(apiKey, baseUrl, timeout);
    this.batchFetch = new BatchFetchService(apiKey, baseUrl, timeout);
  }

  /**
   * Fetch a web page and extract content
   * @param params The parameters for the fetch operation
   */
  async fetch(params: FetchParams): Promise<FetchResponse> {
    try {
      const processedParams = this.processOutputParams(params);
      return await this.request<FetchResponse>("/web/fetch", {
        method: "POST",
        body: JSON.stringify(processedParams),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to fetch web page", undefined);
    }
  }

  /**
   * Perform a web search
   * @param params The parameters for the web search
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
      throw new HyperbrowserError("Failed to perform web search", undefined);
    }
  }

  private processOutputParams<T extends { outputs?: FetchOutputLike[] }>(params: T): T {
    if (!params.outputs) {
      return params;
    }

    const processedOutputs = params.outputs.map((output) => {
      if (typeof output === "object" && output.type === "json") {
        const jsonOutput = output as FetchOutputJson;
        if (jsonOutput.options?.schema) {
          const schema = jsonOutput.options.schema as { toJsonSchema?: () => unknown };
          if (typeof schema.toJsonSchema === "function") {
            return {
              ...jsonOutput,
              options: {
                ...jsonOutput.options,
                schema: schema.toJsonSchema(),
              },
            };
          }
        }
      }
      return output;
    });

    return { ...params, outputs: processedOutputs };
  }
}
