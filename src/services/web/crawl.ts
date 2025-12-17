import { toJSONSchema } from "zod";
import {
  WebCrawlJobResponse,
  WebCrawlJobStatusResponse,
  GetWebCrawlJobParams,
  StartWebCrawlJobParams,
  StartWebCrawlJobResponse,
} from "../../types/web/crawl";
import { BaseService } from "../base";
import { isZodSchema, sleep } from "../../utils";
import { HyperbrowserError } from "../../client";
import { CrawlJobStatus, POLLING_ATTEMPTS } from "../../types/constants";

export class WebCrawlService extends BaseService {
  /**
   * Start a new crawl job
   * @param params The parameters for the crawl job
   */
  async start(params: StartWebCrawlJobParams): Promise<StartWebCrawlJobResponse> {
    try {
      const jsonOutput = params.outputs?.find(
        (output) => typeof output === "object" && output.type === "json"
      );
      if (jsonOutput && jsonOutput.options?.schema) {
        if (isZodSchema(jsonOutput.options.schema)) {
          jsonOutput.options.schema = toJSONSchema(jsonOutput.options.schema);
        }
      }
      return await this.request<StartWebCrawlJobResponse>("/web/crawl", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start crawl job", undefined);
    }
  }

  /**
   * Get the status of a crawl job
   * @param id The ID of the crawl job to get
   */
  async getStatus(id: string): Promise<WebCrawlJobStatusResponse> {
    try {
      return await this.request<WebCrawlJobStatusResponse>(`/web/crawl/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get crawl job status ${id}`, undefined);
    }
  }

  /**
   * Get the status of a crawl job
   * @param id The ID of the crawl job to get
   * @param params Optional parameters to filter the crawl job
   */
  async get(id: string, params?: GetWebCrawlJobParams): Promise<WebCrawlJobResponse> {
    try {
      return await this.request<WebCrawlJobResponse>(`/web/crawl/${id}`, undefined, {
        page: params?.page,
        batchSize: params?.batchSize,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get crawl job ${id}`, undefined);
    }
  }

  /**
   * Start a crawl job and wait for it to complete
   * @param params The parameters for the crawl job
   * @param returnAllPages Whether to return all pages in the crawl job response
   */
  async startAndWait(
    params: StartWebCrawlJobParams,
    returnAllPages: boolean = true
  ): Promise<WebCrawlJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start crawl job, could not get job ID");
    }

    let failures = 0;
    let jobStatus: CrawlJobStatus = "pending";
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
            `Failed to poll crawl job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
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
              `Failed to get crawl job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
            );
          }
        }
        await sleep(500);
      }
    }

    failures = 0;

    const jobResponse: WebCrawlJobResponse = {
      jobId,
      status: jobStatus,
      data: [],
      currentPageBatch: 0,
      totalPageBatches: 0,
      totalCrawledPages: 0,
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
        jobResponse.totalCrawledPages = tmpJobResponse.totalCrawledPages;
        jobResponse.totalPageBatches = tmpJobResponse.totalPageBatches;
        jobResponse.batchSize = tmpJobResponse.batchSize;
        failures = 0;
        firstCheck = false;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to get crawl job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(500);
    }
    return jobResponse;
  }
}
