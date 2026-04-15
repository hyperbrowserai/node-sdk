import { HeadersInit, RequestInit, Response } from "node-fetch";
import {
  ControlAuthError,
  ControlPlaneAuthManager,
  normalizeControlPlaneBaseUrl,
  RequestInitFactory,
} from "../control-auth";
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
  return response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
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

const toHeaderMap = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) {
    return {};
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  }
  if (typeof (headers as { forEach?: unknown }).forEach === "function") {
    const values: Record<string, string> = {};
    (headers as { forEach: (callback: (value: string, key: string) => void) => void }).forEach(
      (value, key) => {
        values[key] = value;
      }
    );
    return values;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value === undefined ? "" : String(value)])
  );
};

const normalizeRequestInit = (init?: RequestInit): RequestInit => {
  const requestHeaders = toHeaderMap(init?.headers);
  return {
    ...init,
    headers: {
      "content-type":
        requestHeaders["content-type"] || requestHeaders["Content-Type"] || "application/json",
      ...requestHeaders,
    },
  };
};

export class BaseService {
  protected readonly auth: ControlPlaneAuthManager;
  protected readonly baseUrl: string;
  protected readonly timeout: number;

  constructor(
    auth: string | ControlPlaneAuthManager,
    baseUrl: string,
    timeout: number = 30000
  ) {
    this.auth =
      typeof auth === "string"
        ? new ControlPlaneAuthManager({
            kind: "api_key",
            apiKey: auth,
          })
        : auth;
    this.baseUrl = normalizeControlPlaneBaseUrl(baseUrl);
    this.timeout = timeout;
  }

  protected async request<T>(
    path: string,
    init?: RequestInit | RequestInitFactory,
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

      const requestInit =
        typeof init === "function"
          ? async () => normalizeRequestInit(await init())
          : normalizeRequestInit(init);
      const response = await this.auth.fetch(url.toString(), requestInit, this.timeout);

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
      if (error instanceof ControlAuthError) {
        throw new HyperbrowserError(error.message, {
          statusCode: error.statusCode,
          code: error.code,
          retryable: error.retryable,
          service: "control",
          details: error.details,
          cause: error.cause ?? error,
        });
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
