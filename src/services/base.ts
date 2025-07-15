import fetch, { HeadersInit, RequestInit } from "node-fetch";
import { HyperbrowserError } from "../client";

export class BaseService {
  constructor(
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly timeout: number = 30000
  ) {}

  protected async request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | undefined>,
    fullUrl: boolean = false
  ): Promise<T> {
    try {
      const url = new URL(fullUrl ? path : `${this.baseUrl}/api${path}`);

      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            url.searchParams.append(key, value.toString());
          }
        });
      }

      const headerKeys = Object.keys(init?.headers || {});
      const contentTypeKey = headerKeys.find(
        (key) => key.toLowerCase() === "content-type"
      ) as keyof HeadersInit;

      const response = await fetch(url.toString(), {
        ...init,
        timeout: this.timeout,
        headers: {
          "x-api-key": this.apiKey,
          ...(contentTypeKey && init?.headers
            ? { "content-type": init.headers[contentTypeKey] as string }
            : { "content-type": "application/json" }),
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
        throw new HyperbrowserError(errorMessage, response.status);
      }

      if (response.headers.get("content-length") === "0") {
        return {} as T;
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new HyperbrowserError("Failed to parse JSON response", response.status);
      }
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown error occurred",
        undefined
      );
    }
  }
}
