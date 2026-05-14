import { HyperbrowserError } from "../../client";
import { BasicResponse } from "../../types";
import { POLLING_ATTEMPTS } from "../../types/constants";
import {
  StartTaskParams,
  StartTaskResponse,
  TaskResponse,
  TaskStatusResponse,
} from "../../types/agents/task";
import { sleep } from "../../utils";
import { BaseService } from "../base";

export class TaskService extends BaseService {
  async start(params: StartTaskParams): Promise<StartTaskResponse> {
    try {
      return await this.request<StartTaskResponse>("/task", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start task job", undefined);
    }
  }

  async getStatus(id: string): Promise<TaskStatusResponse> {
    try {
      return await this.request<TaskStatusResponse>(`/task/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get task job ${id} status`, undefined);
    }
  }

  async get(id: string): Promise<TaskResponse> {
    try {
      return await this.request<TaskResponse>(`/task/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get task job ${id}`, undefined);
    }
  }

  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/task/${id}/stop`, { method: "PUT" });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop task job ${id}`, undefined);
    }
  }

  async startAndWait(params: StartTaskParams): Promise<TaskResponse> {
    const jobStartResp = await this.start(params);
    const jobId = jobStartResp.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start task job");
    }

    let failures = 0;
    while (true) {
      try {
        const jobResponse = await this.getStatus(jobId);
        if (["completed", "failed", "stopped"].includes(jobResponse.status)) {
          return await this.get(jobId);
        }
        failures = 0;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw error;
        }
      }
      await sleep(1000);
    }
  }
}
