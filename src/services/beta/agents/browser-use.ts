import { HyperbrowserError } from "../../../client";
import { BasicResponse } from "../../../types";
import { POLLING_ATTEMPTS } from "../../../types/constants";
import {
  StartBrowserUseJobParams,
  StartBrowserUseJobResponse,
  BrowserUseJobResponse,
  BrowserUseJobStatusResponse,
} from "../../../types/beta/agents/browser-use";
import { sleep } from "../../../utils";
import { BaseService } from "../../base";

export class BrowserUseService extends BaseService {
  /**
   * Start a new browser-use task job
   * @param params The parameters for the task job
   */
  async start(params: StartBrowserUseJobParams): Promise<StartBrowserUseJobResponse> {
    try {
      return await this.request<StartBrowserUseJobResponse>("/task/browser-use", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start browser-use task job", undefined);
    }
  }

  /**
   * Get the status of a browser-use task job
   * @param id The ID of the task job to get
   */
  async getStatus(id: string): Promise<BrowserUseJobStatusResponse> {
    try {
      return await this.request<BrowserUseJobStatusResponse>(`/task/browser-use/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get browser-use task job ${id} status`, undefined);
    }
  }

  /**
   * Get the result of a task job
   * @param id The ID of the task job to get
   */
  async get(id: string): Promise<BrowserUseJobResponse> {
    try {
      return await this.request<BrowserUseJobResponse>(`/task/browser-use/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get browser-use task job ${id}`, undefined);
    }
  }

  /**
   * Stop a task job
   * @param id The ID of the task job to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/browser-use/${id}/stop`, { method: "PUT" });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop browser-use task job ${id}`, undefined);
    }
  }

  /**
   * Start a browser-use task job and wait for it to complete
   * @param params The parameters for the task job
   */
  async startAndWait(params: StartBrowserUseJobParams): Promise<BrowserUseJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start browser-use task job, could not get job ID");
    }

    let failures = 0;
    while (true) {
      try {
        const { status } = await this.getStatus(jobId);
        if (status === "completed" || status === "failed" || status === "stopped") {
          return await this.get(jobId);
        }
        failures = 0;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to poll browser-use task job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
