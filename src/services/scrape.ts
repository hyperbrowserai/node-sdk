import { ScrapeJobResponse, StartScrapeJobParams, StartScrapeJobResponse } from "../types/scrape";
import { BaseService } from "./base";
import { sleep } from "../utils";
import { HyperbrowserError } from "../client";

export class ScrapeService extends BaseService {
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
      throw new HyperbrowserError(
        "Failed to start scrape job",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the status of a scrape job
   * @param id The ID of the scrape job to get
   */
  async get(id: string): Promise<ScrapeJobResponse> {
    try {
      return await this.request<ScrapeJobResponse>(`/scrape/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get scrape job ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
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

    let jobResponse: ScrapeJobResponse;
    while (true) {
      jobResponse = await this.get(jobId);
      if (jobResponse.status === "completed" || jobResponse.status === "failed") {
        break;
      }
      await sleep(2000);
    }
    return jobResponse;
  }
}
