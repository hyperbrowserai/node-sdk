import fetch, { HeadersInit, RequestInit, Response } from "node-fetch";
import { HyperbrowserError } from "../error";
import {
  getRetryDelayMs,
  isRetryableNetworkError,
  RETRYABLE_STATUS_CODES,
  retryDelay,
  shouldRetryGet,
} from "../retry";

const getRequestId = (response: Response): string | undefined => {
  return response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
};

export class BaseService {
  constructor(
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly timeout: number = 30000
  ) {}

  /** Transient GET failures (429/502/503/504, network errors) retry up to three attempts. */
  protected async request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | string[] | undefined>,
    fullUrl: boolean = false
  ): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    let failedAttempt = 1;
    for (;;) {
      try {
        return await this.requestOnce<T>(path, init, params, fullUrl);
      } catch (error) {
        if (
          init?.signal?.aborted ||
          !(error instanceof HyperbrowserError) ||
          !shouldRetryGet(method, error, failedAttempt)
        ) {
          throw error;
        }
        await retryDelay(getRetryDelayMs(failedAttempt), init?.signal ?? undefined);
        failedAttempt += 1;
      }
    }
  }

  private async requestOnce<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, string | number | string[] | undefined>,
    fullUrl: boolean = false
  ): Promise<T> {
    let response: Response | undefined;
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

      const requestTimeout = init?.timeout ?? this.timeout;

      response = await fetch(url.toString(), {
        ...init,
        timeout: requestTimeout,
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
          errorCode = typeof errorData?.code === "string" ? errorData.code : undefined;
          errorMessage =
            errorData.message || errorData.error || `HTTP error! status: ${response.status}`;
        } catch (error) {
          if (init?.signal?.aborted) throw error;
          errorMessage = `HTTP error! status: ${response.status}`;
        }
        throw new HyperbrowserError(errorMessage, {
          statusCode: response.status,
          code: errorCode,
          requestId: getRequestId(response),
          retryable: RETRYABLE_STATUS_CODES.has(response.status),
          service: "control",
          details: errorDetails,
          method: init?.method ?? "GET",
          path: path.split("?", 1)[0],
        });
      }

      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch (cause) {
        throw new HyperbrowserError("Failed to parse JSON response", {
          statusCode: response.status,
          requestId: getRequestId(response),
          retryable: false,
          service: "control",
          cause,
          method: init?.method ?? "GET",
          path: path.split("?", 1)[0],
        });
      }
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }

      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          code: init?.signal?.aborted ? "request_aborted" : undefined,
          retryable: !init?.signal?.aborted && isRetryableNetworkError(error),
          method: init?.method ?? "GET",
          path: path.split("?", 1)[0],
          service: "control",
          cause: error,
          statusCode: response?.status,
          requestId: response ? getRequestId(response) : undefined,
        }
      );
    }
  }
}
