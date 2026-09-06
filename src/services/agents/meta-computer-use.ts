import { HyperbrowserError } from "../../client";
import { BasicResponse } from "../../types";
import { POLLING_ATTEMPTS } from "../../types/constants";
import { sleep } from "../../utils";
import { BaseService } from "../base";
import {
  MetaComputerUseTaskResponse,
  MetaComputerUseTaskStatusResponse,
  StartMetaComputerUseTaskParams,
  StartMetaComputerUseTaskResponse,
} from "../../types/agents/meta-computer-use";

export class MetaComputerUseService extends BaseService {
  /**
   * Start a new Meta Computer Use task job
   * @param params The parameters for the task job
   */
  async start(params: StartMetaComputerUseTaskParams): Promise<StartMetaComputerUseTaskResponse> {
    try {
      return await this.request<StartMetaComputerUseTaskResponse>("/task/meta-computer-use", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start Meta Computer Use task job", undefined);
    }
  }

  /**
   * Get the status of a Meta Computer Use task job
   * @param id The ID of the task job to get
   */
  async getStatus(id: string): Promise<MetaComputerUseTaskStatusResponse> {
    try {
      return await this.request<MetaComputerUseTaskStatusResponse>(
        `/task/meta-computer-use/${id}/status`
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get Meta Computer Use task job ${id} status`,
        undefined
      );
    }
  }

  /**
   * Get the result of a Meta Computer Use task job
   * @param id The ID of the task job to get
   */
  async get(id: string): Promise<MetaComputerUseTaskResponse> {
    try {
      return await this.request<MetaComputerUseTaskResponse>(`/task/meta-computer-use/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get Meta Computer Use task job ${id}`, undefined);
    }
  }

  /**
   * Stop a Meta Computer Use task job
   * @param id The ID of the task job to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/meta-computer-use/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop Meta Computer Use task job ${id}`, undefined);
    }
  }

  /**
   * Start a Meta Computer Use task job and wait for it to complete
   * @param params The parameters for the task job
   */
  async startAndWait(params: StartMetaComputerUseTaskParams): Promise<MetaComputerUseTaskResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError(
        "Failed to start Meta Computer Use task job, could not get job ID"
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
            `Failed to poll Meta Computer Use task job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
