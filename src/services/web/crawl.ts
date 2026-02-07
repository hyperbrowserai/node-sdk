import zodToJsonSchema from "zod-to-json-schema";
import { toJSONSchema } from "zod";
import { BaseService } from "../base";
import { sleep } from "../../utils";
import { HyperbrowserError } from "../../client";
import { POLLING_ATTEMPTS } from "../../types/constants";
import { FetchOutputJson } from "../../types/web/common";
import { isZodSchema } from "../../utils";
import {
  GetWebCrawlJobParams,
  StartWebCrawlJobParams,
  StartWebCrawlJobResponse,
  WebCrawlJobResponse,
  WebCrawlJobStatus,
  WebCrawlJobStatusResponse,
} from "../../types/web/crawl";

export class WebCrawlService extends BaseService {
  /**
   * Start a new web crawl job
   * @param params The parameters for the web crawl job
   */
  async start(params: StartWebCrawlJobParams): Promise<StartWebCrawlJobResponse> {
    try {
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

      return await this.request<StartWebCrawlJobResponse>("/web/crawl", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start web crawl job", undefined);
    }
  }

  /**
   * Get the status of a web crawl job
   * @param id The ID of the web crawl job to get
   */
  async getStatus(id: string): Promise<WebCrawlJobStatusResponse> {
    try {
      return await this.request<WebCrawlJobStatusResponse>(`/web/crawl/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get web crawl job ${id} status`, undefined);
    }
  }

  /**
   * Get the details of a web crawl job
   * @param id The ID of the web crawl job to get
   * @param params Optional parameters to filter the web crawl job
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
      throw new HyperbrowserError(`Failed to get web crawl job ${id}`, undefined);
    }
  }

  /**
   * Start a web crawl job and wait for it to complete
   * @param params The parameters for the web crawl job
   * @param returnAllPages Whether to return all pages in the web crawl job response
   */
  async startAndWait(
    params: StartWebCrawlJobParams,
    returnAllPages: boolean = true
  ): Promise<WebCrawlJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start web crawl job, could not get job ID");
    }

    let failures = 0;
    let jobStatus: WebCrawlJobStatus = "pending";
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
            `Failed to poll web crawl job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
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
              `Failed to get web crawl job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
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
            `Failed to get web crawl page ${jobResponse.currentPageBatch + 1} for job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(500);
    }
    return jobResponse;
  }
}
