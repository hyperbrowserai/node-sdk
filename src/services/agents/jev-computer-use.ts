import { HyperbrowserError } from "../../client";
import { BasicResponse } from "../../types";
import { POLLING_ATTEMPTS } from "../../types/constants";
import { sleep } from "../../utils";
import { BaseService } from "../base";
import {
  JevComputerUseTaskResponse,
  JevComputerUseTaskStatusResponse,
  StartJevComputerUseTaskParams,
  StartJevComputerUseTaskResponse,
} from "../../types/agents/jev-computer-use";

export class JevComputerUseService extends BaseService {
  /**
   * Start a new Jev Computer Use task job
   * @param params The parameters for the task job
   */
  async start(params: StartJevComputerUseTaskParams): Promise<StartJevComputerUseTaskResponse> {
    try {
      return await this.request<StartJevComputerUseTaskResponse>("/task/jev", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start Jev Computer Use task job", undefined);
    }
  }

  /**
   * Get the status of a Jev Computer Use task job
   * @param id The ID of the task job to get
   */
  async getStatus(id: string): Promise<JevComputerUseTaskStatusResponse> {
    try {
      return await this.request<JevComputerUseTaskStatusResponse>(`/task/jev/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get Jev Computer Use task job ${id} status`,
        undefined
      );
    }
  }

  /**
   * Get the result of a Jev Computer Use task job
   * @param id The ID of the task job to get
   */
  async get(id: string): Promise<JevComputerUseTaskResponse> {
    try {
      return await this.request<JevComputerUseTaskResponse>(`/task/jev/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get Jev Computer Use task job ${id}`, undefined);
    }
  }

  /**
   * Stop a Jev Computer Use task job
   * @param id The ID of the task job to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/jev/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop Jev Computer Use task job ${id}`, undefined);
    }
  }

  /**
   * Start a Jev Computer Use task job and wait for it to complete
   * @param params The parameters for the task job
   */
  async startAndWait(params: StartJevComputerUseTaskParams): Promise<JevComputerUseTaskResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError(
        "Failed to start Jev Computer Use task job, could not get job ID"
      );
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
            `Failed to poll Jev Computer Use task job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
