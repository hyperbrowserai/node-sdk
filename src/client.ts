import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";
import {
  BasicResponse,
  CreateSessionParams,
  SessionDetail,
  SessionListParams,
  SessionListResponse,
} from "./types/session";
import { ScrapeJobResponse, StartScrapeJobParams, StartScrapeJobResponse } from "./types/scrape";
import {
  CrawlJobResponse,
  GetCrawlJobParams,
  StartCrawlJobParams,
  StartCrawlJobResponse,
} from "./types/crawl";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HyperbrowserError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: Response,
    public originalError?: Error
  ) {
    super(`[Hyperbrowser]: ${message}`);
    this.name = "HyperbrowserError";
  }
}

export class HyperbrowserClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: HyperbrowserConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://app.hyperbrowser.ai";

    if (!this.apiKey) {
      throw new HyperbrowserError("API key is required");
    }
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    try {
      const url = new URL(`${this.baseUrl}/api${path}`);

      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            url.searchParams.append(key, value.toString());
          }
        });
      }

      const response = await fetch(url.toString(), {
        ...init,
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        let errorMessage: string;
        try {
          const errorData = await response.json();
          errorMessage =
            errorData.message || errorData.error || `HTTP error! status: ${response.status}`;
        } catch {
          errorMessage = `HTTP error! status: ${response.status}`;
        }
        throw new HyperbrowserError(errorMessage, response.status, response);
      }

      if (response.headers.get("content-length") === "0") {
        return {} as T;
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new HyperbrowserError(
          "Failed to parse JSON response",
          response.status,
          response,
          error instanceof Error ? error : undefined
        );
      }
    } catch (error) {
      // If it's already a HyperbrowserError, rethrow it
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      // Convert other errors to HyperbrowserError
      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown error occurred",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create a new browser session
   * @param params Configuration parameters for the new session
   */
  async createSession(params?: CreateSessionParams): Promise<SessionDetail> {
    try {
      return await this.request<SessionDetail>("/session", {
        method: "POST",
        body: params ? JSON.stringify(params) : undefined,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        "Failed to create session",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get details of an existing session
   */
  async getSession(id: string): Promise<SessionDetail> {
    try {
      return await this.request<SessionDetail>(`/session/${id}`);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get session ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stop a running session
   */
  async stopSession(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/session/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to stop session ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * List all sessions with optional filtering
   */
  async listSessions(params: SessionListParams = {}): Promise<SessionListResponse> {
    try {
      return await this.request<SessionListResponse>("/sessions", undefined, {
        status: params.status,
        page: params.page,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        "Failed to list sessions",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  async startScrapeJob(params: StartScrapeJobParams): Promise<StartScrapeJobResponse> {
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

  async getScrapeJob(id: string): Promise<ScrapeJobResponse> {
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

  async startCrawlJob(params: StartCrawlJobParams): Promise<StartCrawlJobResponse> {
    try {
      return await this.request<StartCrawlJobResponse>("/crawl", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        "Failed to start crawl job",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getCrawlJob(id: string, params?: GetCrawlJobParams): Promise<CrawlJobResponse> {
    try {
      return await this.request<CrawlJobResponse>(`/crawl/${id}`, undefined, {
        page: params?.page,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to get crawl job ${id}`,
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  async startScrapeAndWaitUntilComplete(params: StartScrapeJobParams): Promise<ScrapeJobResponse> {
    const job = await this.startScrapeJob(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start scrape job, could not get job ID");
    }

    let jobResponse: ScrapeJobResponse;
    while (true) {
      jobResponse = await this.getScrapeJob(jobId);
      if (jobResponse.status === "completed" || jobResponse.status === "failed") {
        break;
      }
      await sleep(2000);
    }
    return jobResponse;
  }

  async startCrawlAndWaitUntilComplete(
    params: StartCrawlJobParams,
    returnAllPages: boolean = false
  ): Promise<CrawlJobResponse> {
    const job = await this.startCrawlJob(params);
    const jobId = job.jobId;
    if (!jobId) {
      throw new HyperbrowserError("Failed to start crawl job, could not get job ID");
    }

    let jobResponse: CrawlJobResponse;
    while (true) {
      jobResponse = await this.getCrawlJob(jobId);
      if (jobResponse.status === "completed" || jobResponse.status === "failed") {
        break;
      }
      await sleep(2000);
    }

    if (!returnAllPages) {
      return jobResponse;
    }

    while (jobResponse.currentPageBatch < jobResponse.totalPageBatches) {
      const tmpJobResponse = await this.getCrawlJob(jobId, {
        page: jobResponse.currentPageBatch + 1,
      });
      if (tmpJobResponse.data) {
        jobResponse.data?.push(...tmpJobResponse.data);
      }
      jobResponse.currentPageBatch = tmpJobResponse.currentPageBatch;
      jobResponse.totalCrawledPages = tmpJobResponse.totalCrawledPages;
      jobResponse.totalPageBatches = tmpJobResponse.totalPageBatches;
      jobResponse.batchSize = tmpJobResponse.batchSize;
      await sleep(500);
    }
    return jobResponse;
  }
}
