import {
  BatchScrapeJobResponse,
  BatchScrapeJobStatusResponse,
  GetBatchScrapeJobParams,
  ScrapeJobResponse,
  ScrapeJobStatusResponse,
  StartBatchScrapeJobParams,
  StartBatchScrapeJobResponse,
  StartScrapeJobParams,
  StartScrapeJobResponse,
} from "../types/scrape";
import { BaseService } from "./base";
import { sleep } from "../utils";
import { HyperbrowserError } from "../client";
import { POLLING_ATTEMPTS, ScrapeJobStatus } from "../types/constants";

export class BatchScrapeService extends BaseService {
  /**
   * Start a new batch scrape job
   * @param params The parameters for the batch scrape job
   */
  async start(params: StartBatchScrapeJobParams): Promise<StartBatchScrapeJobResponse> {
    try {
      return await this.request<StartBatchScrapeJobResponse>("/scrape/batch", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start batch scrape job", undefined);
    }
  }

  /**
   * Get the status of a batch scrape job
   * @param id The ID of the batch scrape job to get
   */
  async getStatus(id: string): Promise<BatchScrapeJobStatusResponse> {
    try {
      return await this.request<BatchScrapeJobStatusResponse>(`/scrape/batch/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get batch scrape job ${id} status`, undefined);
    }
  }

  /**
   * Get the details of a batch scrape job
   * @param id The ID of the batch scrape job to get
   * @param params Optional parameters to filter the batch scrape job
   */
  async get(id: string, params?: GetBatchScrapeJobParams): Promise<BatchScrapeJobResponse> {
    try {
      return await this.request<BatchScrapeJobResponse>(`/scrape/batch/${id}`, undefined, {
        page: params?.page,
        batchSize: params?.batchSize,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get batch scrape job ${id}`, undefined);
    }
  }

  /**
   * Start a batch scrape job and wait for it to complete
   * @param params The parameters for the batch scrape job
   * @param returnAllPages Whether to return all pages in the batch scrape job response
   */
  async startAndWait(
    params: StartBatchScrapeJobParams,
    returnAllPages: boolean = true
  ): Promise<BatchScrapeJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start batch scrape job, could not get job ID");
    }

    let failures = 0;
    let jobStatus: ScrapeJobStatus = "pending";
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
            `Failed to poll batch scrape job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
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
              `Failed to get batch scrape job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
            );
          }
        }
        await sleep(500);
      }
    }

    failures = 0;

    const jobResponse: BatchScrapeJobResponse = {
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

export class ScrapeService extends BaseService {
  public readonly batch: BatchScrapeService;

  constructor(apiKey: string, baseUrl: string, timeout: number) {
    super(apiKey, baseUrl, timeout);
    this.batch = new BatchScrapeService(apiKey, baseUrl, timeout);
  }

  /**
   * Start a new scrape job
   * @param params The parameters for the scrape job
   */
  async start(params: StartScrapeJobParams): Promise<StartScrapeJobResponse> {
    try {
      return await this.request<StartScrapeJobResponse>("/scrape", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start scrape job", undefined);
    }
  }

  /**
   * Get the status of a scrape job
   * @param id The ID of the scrape job to get
   */
  async getStatus(id: string): Promise<ScrapeJobStatusResponse> {
    try {
      return await this.request<ScrapeJobStatusResponse>(`/scrape/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get scrape job status ${id}`, undefined);
    }
  }

  /**
   * Get the details of a scrape job
   * @param id The ID of the scrape job to get
   */
  async get(id: string): Promise<ScrapeJobResponse> {
    try {
      return await this.request<ScrapeJobResponse>(`/scrape/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get scrape job ${id}`, undefined);
    }
  }

  /**
   * Start a scrape job and wait for it to complete
   * @param params The parameters for the scrape job
   */
  async startAndWait(params: StartScrapeJobParams): Promise<ScrapeJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start scrape job, could not get job ID");
    }

    let failures = 0;
    while (true) {
      try {
        const { status } = await this.getStatus(jobId);
        if (status === "completed" || status === "failed") {
          return await this.get(jobId);
        }
        failures = 0;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to poll scrape job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
