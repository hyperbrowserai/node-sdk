import { toJSONSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseService } from "../base";
import { isZodSchema, sleep } from "../../utils";
import { HyperbrowserError } from "../../client";
import {
  DeepFetchJobResponse,
  DeepFetchJobStatusResponse,
  StartDeepFetchJobResponse,
  StartDeepFetchJobParams,
} from "../../types/web/deep-fetch";
import { POLLING_ATTEMPTS } from "../../types/constants";

export class DeepFetchService extends BaseService {
  /**
   * Start a new deep fetch job
   * @param params The parameters for the deep fetch job
   */
  async start(params: StartDeepFetchJobParams): Promise<StartDeepFetchJobResponse> {
    try {
      if (!params.schema && !params.prompt) {
        throw new HyperbrowserError("Either schema or prompt must be provided");
      }
      if (params.schema) {
        if (isZodSchema(params.schema)) {
          try {
            params.schema = toJSONSchema(params.schema);
          } catch {
            params.schema = zodToJsonSchema(params.schema as any);
          }
        }
      }
      return await this.request<StartDeepFetchJobResponse>("/web/deep-fetch", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start deep fetch job", undefined);
    }
  }

  /**
   * Get the status of a deep fetch job
   * @param id The ID of the deep fetch job to get
   */
  async getStatus(id: string): Promise<DeepFetchJobStatusResponse> {
    try {
      return await this.request<DeepFetchJobStatusResponse>(`/web/deep-fetch/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get deep fetch job status ${id}`, undefined);
    }
  }

  /**
   * Get the details of a deep fetch job
   * @param id The ID of the deep fetch job to get
   */
  async get(id: string): Promise<DeepFetchJobResponse> {
    try {
      return await this.request<DeepFetchJobResponse>(`/web/deep-fetch/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get deep fetch job ${id}`, undefined);
    }
  }

  /**
   * Start a deep fetch job and wait for it to complete
   * @param params The parameters for the deep fetch job
   */
  async startAndWait(params: StartDeepFetchJobParams): Promise<DeepFetchJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start deep fetch job, could not get job ID");
    }

    let failures = 0;
    while (true) {
      try {
        const { status } = await this.getStatus(jobId);
        if (status === "completed" || status === "failed") {
          return await this.get(jobId);
        }
        failures = 0;
      } catch (error) {
        failures++;
        if (failures >= POLLING_ATTEMPTS) {
          throw new HyperbrowserError(
            `Failed to poll deep fetch job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
