import fetch, { HeadersInit, RequestInit, Response } from "node-fetch";
import { HyperbrowserError } from "../client";

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
]);

const getRequestId = (response: Response): string | undefined => {
  return (
    response.headers.get("x-request-id") ||
    response.headers.get("request-id") ||
    undefined
  );
};

const isRetryableNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const networkError = error as Error & { code?: string; type?: string };
  return (
    networkError.name === "AbortError" ||
    networkError.type === "request-timeout" ||
    (networkError.code ? RETRYABLE_NETWORK_CODES.has(networkError.code) : false)
  );
};

export class BaseService {
  constructor(
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly timeout: number = 30000
  ) {}

  protected async request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | string[] | undefined>,
    fullUrl: boolean = false
  ): Promise<T> {
    try {
      const url = new URL(fullUrl ? path : `${this.baseUrl}/api${path}`);

      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              value.forEach((item) => {
                url.searchParams.append(key, item.toString());
              });
            } else {
              url.searchParams.append(key, value.toString());
            }
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
        let errorDetails: unknown;
        let errorCode: string | undefined;
        try {
          const errorData = await response.json();
          errorDetails = errorData;
          errorCode =
            typeof errorData?.code === "string" ? errorData.code : undefined;
          errorMessage =
            errorData.message || errorData.error || `HTTP error! status: ${response.status}`;
        } catch {
          errorMessage = `HTTP error! status: ${response.status}`;
        }
        throw new HyperbrowserError(errorMessage, {
          statusCode: response.status,
          code: errorCode,
          requestId: getRequestId(response),
          retryable: RETRYABLE_STATUS_CODES.has(response.status),
          service: "control",
          details: errorDetails,
        });
      }

      if (response.headers.get("content-length") === "0") {
        return {} as T;
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new HyperbrowserError("Failed to parse JSON response", {
          statusCode: response.status,
          requestId: getRequestId(response),
          retryable: false,
          service: "control",
        });
      }
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          retryable: isRetryableNetworkError(error),
          service: "control",
          cause: error,
        }
      );
    }
  }
}
