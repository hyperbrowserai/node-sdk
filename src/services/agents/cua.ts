import { HyperbrowserError } from "../../client";
import { BasicResponse } from "../../types";
import { POLLING_ATTEMPTS } from "../../types/constants";
import { sleep } from "../../utils";
import { BaseService } from "../base";
import {
  CuaTaskResponse,
  CuaTaskStatusResponse,
  StartCuaTaskParams,
  StartCuaTaskResponse,
} from "../../types/agents/cua";

export class CuaService extends BaseService {
  /**
   * Start a new CUA task job
   * @param params The parameters for the task job
   */
  async start(params: StartCuaTaskParams): Promise<StartCuaTaskResponse> {
    try {
      return await this.request<StartCuaTaskResponse>("/task/cua", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start CUA task job", undefined);
    }
  }

  /**
   * Get the status of a CUA task job
   * @param id The ID of the task job to get
   */
  async getStatus(id: string): Promise<CuaTaskStatusResponse> {
    try {
      return await this.request<CuaTaskStatusResponse>(`/task/cua/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get CUA task job ${id} status`, undefined);
    }
  }

  /**
   * Get the result of a CUA task job
   * @param id The ID of the task job to get
   */
  async get(id: string): Promise<CuaTaskResponse> {
    try {
      return await this.request<CuaTaskResponse>(`/task/cua/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get CUA task job ${id}`, undefined);
    }
  }

  /**
   * Stop a CUA task job
   * @param id The ID of the task job to stop
   */
  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/cua/${id}/stop`, { method: "PUT" });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop CUA task job ${id}`, undefined);
    }
  }

  /**
   * Start a CUA task job and wait for it to complete
   * @param params The parameters for the task job
   */
  async startAndWait(params: StartCuaTaskParams): Promise<CuaTaskResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start CUA task job, could not get job ID");
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
            `Failed to poll CUA task job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
