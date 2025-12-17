import { toJSONSchema } from "zod";
import {
  BatchFetchJobResponse,
  BatchFetchJobStatusResponse,
  GetBatchFetchJobParams,
  StartBatchFetchJobResponse,
  StartBatchFetchParams,
} from "../../types/web/fetch";
import { BaseService } from "../base";
import { isZodSchema, sleep } from "../../utils";
import { HyperbrowserError } from "../../client";
import { POLLING_ATTEMPTS, FetchStatus } from "../../types/constants";

export class BatchFetchService extends BaseService {
  /**
   * Start a new batch fetch job
   * @param params The parameters for the batch fetch job
   */
  async start(params: StartBatchFetchParams): Promise<StartBatchFetchJobResponse> {
    try {
      const jsonOutput = params.outputs?.find(
        (output) => typeof output === "object" && output.type === "json"
      );
      if (jsonOutput && jsonOutput.options?.schema) {
        if (isZodSchema(jsonOutput.options.schema)) {
          jsonOutput.options.schema = toJSONSchema(jsonOutput.options.schema);
        }
      }

      return await this.request<StartBatchFetchJobResponse>("/web/fetch/batch", {
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
      return await this.request<BatchFetchJobStatusResponse>(`/web/fetch/batch/${id}/status`);
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
      return await this.request<BatchFetchJobResponse>(`/web/fetch/batch/${id}`, undefined, {
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
    params: StartBatchFetchParams,
    returnAllPages: boolean = true
  ): Promise<BatchFetchJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start batch fetch job, could not get job ID");
    }

    let failures = 0;
    let jobStatus: FetchStatus = "pending";
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
      totalScrapedPages: 0,
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
        jobResponse.totalScrapedPages = tmpJobResponse.totalScrapedPages;
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
}
