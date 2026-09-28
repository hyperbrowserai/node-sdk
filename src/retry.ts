import { HyperbrowserError } from "./error";

export const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
export const GET_RETRY_MAX_ATTEMPTS = 3;
export const GET_RETRY_INITIAL_DELAY_MS = 250;
export const GET_RETRY_MAX_DELAY_MS = 1_000;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
]);

export const isRetryableNetworkError = (error: unknown): boolean => {
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

export const shouldRetryGet = (
  method: string,
  error: HyperbrowserError,
  failedAttempt: number
): boolean =>
  method.toUpperCase() === "GET" && error.retryable && failedAttempt < GET_RETRY_MAX_ATTEMPTS;

/** Exponential backoff with jitter, capped at one second. */
export const getRetryDelayMs = (failedAttempt: number): number => {
  const maximumDelay = Math.min(
    GET_RETRY_INITIAL_DELAY_MS * 2 ** (failedAttempt - 1),
    GET_RETRY_MAX_DELAY_MS
  );
  return maximumDelay / 2 + Math.random() * (maximumDelay / 2);
};

export const retryDelay = (
  ms: number,
  signal?: {
    readonly aborted: boolean;
    addEventListener: AbortSignal["addEventListener"];
    removeEventListener: AbortSignal["removeEventListener"];
  }
): Promise<void> =>
  new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(
        new HyperbrowserError("Request canceled", { code: "request_aborted", service: "control" })
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    if (signal?.aborted) aborted();
    else signal?.addEventListener("abort", aborted, { once: true });
  });
