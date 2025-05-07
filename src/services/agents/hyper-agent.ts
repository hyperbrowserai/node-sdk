import { HyperbrowserError } from "../../client";
import { BasicResponse } from "../../types";
import { POLLING_ATTEMPTS } from "../../types/constants";
import { sleep } from "../../utils";
import { BaseService } from "../base";
import {
  HyperAgentTaskResponse,
  HyperAgentTaskStatusResponse,
  StartHyperAgentTaskParams,
  StartHyperAgentTaskResponse,
} from "../../types/agents/hyper-agent";

export class HyperAgentService extends BaseService {
  /**
   * Start a new HyperAgent task job
   * @param params The parameters for the task job
   */
  async start(params: StartHyperAgentTaskParams): Promise<StartHyperAgentTaskResponse> {
    try {
      return await this.request<StartHyperAgentTaskResponse>("/task/hyper-agent", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start HyperAgent task job", undefined);
    }
  }

  /**
   * Get the status of a HyperAgent task job
   * @param id The ID of the task job to get
   */
  async getStatus(id: string): Promise<HyperAgentTaskStatusResponse> {
    try {
      return await this.request<HyperAgentTaskStatusResponse>(`/task/hyper-agent/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get HyperAgent task job ${id} status`, undefined);
    }
  }

  /**
   * Get the result of a HyperAgent task job
   * @param id The ID of the task job to get
   */
  async get(id: string): Promise<HyperAgentTaskResponse> {
    try {
      return await this.request<HyperAgentTaskResponse>(`/task/hyper-agent/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get HyperAgent task job ${id}`, undefined);
    }
  }

  /**
   * Stop a HyperAgent task job
   * @param id The ID of the task job to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/hyper-agent/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop HyperAgent task job ${id}`, undefined);
    }
  }

  /**
   * Start a HyperAgent task job and wait for it to complete
   * @param params The parameters for the task job
   */
  async startAndWait(params: StartHyperAgentTaskParams): Promise<HyperAgentTaskResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start HyperAgent task job, could not get job ID");
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
            `Failed to poll HyperAgent task job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
