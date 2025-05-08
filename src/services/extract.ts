import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseService } from "./base";
import { isZodSchema, sleep } from "../utils";
import { HyperbrowserError } from "../client";
import {
  ExtractJobResponse,
  ExtractJobStatusResponse,
  StartExtractJobResponse,
} from "../types/extract";
import { StartExtractJobParams } from "../types/extract";
import { POLLING_ATTEMPTS } from "../types/constants";

export class ExtractService extends BaseService {
  /**
   * Start a new extract job
   * @param params The parameters for the extract job
   */
  async start(params: StartExtractJobParams): Promise<StartExtractJobResponse> {
    try {
      if (!params.schema && !params.prompt) {
        throw new HyperbrowserError("Either schema or prompt must be provided");
      }
      if (params.schema) {
        if (isZodSchema(params.schema)) {
          params.schema = zodToJsonSchema(params.schema);
        }
      }
      return await this.request<StartExtractJobResponse>("/extract", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start extract job", undefined);
    }
  }

  /**
   * Get the status of an extract job
   * @param id The ID of the extract job to get
   */
  async getStatus(id: string): Promise<ExtractJobStatusResponse> {
    try {
      return await this.request<ExtractJobStatusResponse>(`/extract/${id}/status`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get extract job status ${id}`, undefined);
    }
  }

  /**
   * Get the details of an extract job
   * @param id The ID of the extract job to get
   */
  async get(id: string): Promise<ExtractJobResponse> {
    try {
      return await this.request<ExtractJobResponse>(`/extract/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get extract job ${id}`, undefined);
    }
  }

  /**
   * Start an extract job and wait for it to complete
   * @param params The parameters for the extract job
   */
  async startAndWait(params: StartExtractJobParams): Promise<ExtractJobResponse> {
    const job = await this.start(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start extract job, could not get job ID");
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
            `Failed to poll extract job ${jobId} after ${POLLING_ATTEMPTS} attempts: ${error}`
          );
        }
      }
      await sleep(2000);
    }
  }
}
