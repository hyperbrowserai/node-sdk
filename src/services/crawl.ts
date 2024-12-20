import {
  CrawlJobResponse,
  GetCrawlJobParams,
  StartCrawlJobParams,
  StartCrawlJobResponse,
} from "../types/crawl";
import { BaseService } from "./base";
import { sleep } from "../utils";
import { HyperbrowserError } from "../client";

export class CrawlService extends BaseService {
  /**
   * Start a new crawl job
   * @param params The parameters for the crawl job
   */
  async start(params: StartCrawlJobParams): Promise<StartCrawlJobResponse> {
    try {
      return await this.request<StartCrawlJobResponse>("/crawl", {
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
   * @param params Optional parameters to filter the crawl job
   */
  async get(id: string, params?: GetCrawlJobParams): Promise<CrawlJobResponse> {
    try {
      return await this.request<CrawlJobResponse>(`/crawl/${id}`, undefined, {
        page: params?.page,
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
    params: StartCrawlJobParams,
    returnAllPages: boolean = true
  ): Promise<CrawlJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start crawl job, could not get job ID");
    }

    let jobResponse: CrawlJobResponse;
    while (true) {
      jobResponse = await this.get(jobId);
      if (jobResponse.status === "completed" || jobResponse.status === "failed") {
        break;
      }
      await sleep(2000);
    }

    if (!returnAllPages) {
      return jobResponse;
    }

    while (jobResponse.currentPageBatch < jobResponse.totalPageBatches) {
      const tmpJobResponse = await this.get(jobId, {
        page: jobResponse.currentPageBatch + 1,
      });
      if (tmpJobResponse.data) {
        jobResponse.data?.push(...tmpJobResponse.data);
      }
      jobResponse.currentPageBatch = tmpJobResponse.currentPageBatch;
      jobResponse.totalCrawledPages = tmpJobResponse.totalCrawledPages;
      jobResponse.totalPageBatches = tmpJobResponse.totalPageBatches;
      jobResponse.batchSize = tmpJobResponse.batchSize;
      await sleep(500);
    }
    return jobResponse;
  }
}
