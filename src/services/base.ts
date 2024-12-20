import fetch, { RequestInit } from "node-fetch";
import { HyperbrowserError } from "../client";

export class BaseService {
  constructor(
    protected readonly apiKey: string,
    protected readonly baseUrl: string
  ) {}

  protected async request<T>(
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
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown error occurred",
        undefined,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }
}
