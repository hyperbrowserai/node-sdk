import type { IncomingMessage } from "http";
import WebSocket from "ws";
import { HyperbrowserError } from "../client";
import { runtimeBaseUrlSessionId } from "./runtime-path";

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private done = false;
  private error: unknown = null;

  push(value: T) {
    if (this.done) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close() {
    if (this.done) {
      return;
    }

    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown) {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            value: this.values.shift() as T,
            done: false,
          });
        }

        if (this.done) {
          if (this.error) {
            return Promise.reject(this.error);
          }

          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

export interface RuntimeTransportTarget {
  url: string;
  hostHeader?: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
]);

const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

const shouldPrependSandboxToRuntimeAPI = (runtimeBaseUrl: string): boolean => {
  return runtimeBaseUrlSessionId(runtimeBaseUrl) === null;
};

const normalizeRuntimeAPIPath = (pathname: string, prependSandbox: boolean): string => {
  const trimmed = pathname.trim();
  if (!trimmed) {
    return prependSandbox ? "/sandbox" : "/";
  }

  const absolute = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (prependSandbox) {
    if (absolute === "/sandbox" || absolute.startsWith("/sandbox/")) {
      return absolute;
    }
    return `/sandbox${absolute}`;
  }

  if (absolute === "/sandbox") {
    return "/";
  }
  if (absolute.startsWith("/sandbox/")) {
    return `/${absolute.slice("/sandbox/".length)}`;
  }
  return absolute;
};

const normalizeRuntimeRelativePath = (baseUrl: string, path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  const parsedPath = new URL(trimmed, "http://runtime.local");
  const prependSandbox = shouldPrependSandboxToRuntimeAPI(baseUrl);
  const normalizedPath = normalizeRuntimeAPIPath(parsedPath.pathname, prependSandbox);

  const relativePath = normalizedPath.replace(/^\/+/, "");
  return `${relativePath}${parsedPath.search}${parsedPath.hash}`;
};

export const resolveRuntimeTransportTarget = (
  baseUrl: string,
  path: string,
  runtimeProxyOverride?: string
): RuntimeTransportTarget => {
  const url = new URL(
    normalizeRuntimeRelativePath(baseUrl, path),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  );

  if (!runtimeProxyOverride) {
    return {
      url: url.toString(),
    };
  }

  const override = new URL(
    hasScheme(runtimeProxyOverride)
      ? runtimeProxyOverride
      : `${url.protocol}//${runtimeProxyOverride}`
  );

  url.protocol = override.protocol;
  url.username = override.username;
  url.password = override.password;
  url.hostname = override.hostname;
  url.port = override.port || url.port;

  return {
    url: url.toString(),
    hostHeader: new URL(baseUrl).host,
  };
};

export const toWebSocketUrl = (
  baseUrl: string,
  path: string,
  runtimeProxyOverride?: string
): RuntimeTransportTarget => {
  const target = resolveRuntimeTransportTarget(baseUrl, path, runtimeProxyOverride);
  const url = new URL(target.url);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  return {
    url: url.toString(),
    hostHeader: target.hostHeader,
  };
};

const readIncomingMessageBody = (response: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    response.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    response.on("error", reject);
  });

const normalizeWebSocketError = (error: unknown): HyperbrowserError => {
  if (error instanceof HyperbrowserError) {
    return error;
  }

  const networkError = error as Error & { code?: string };
  return new HyperbrowserError(
    error instanceof Error ? error.message : "Unknown runtime websocket error",
    {
      retryable: Boolean(networkError?.code && RETRYABLE_NETWORK_CODES.has(networkError.code)),
      service: "runtime",
      cause: error,
    }
  );
};

const buildHandshakeError = async (response: IncomingMessage): Promise<HyperbrowserError> => {
  const rawText = await readIncomingMessageBody(response);
  let message = `Runtime websocket request failed: ${response.statusCode ?? 0}`;
  let code: string | undefined;
  let details: unknown;

  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as {
        error?: string;
        message?: string;
        code?: string;
      };
      details = parsed;
      code = typeof parsed.code === "string" ? parsed.code : undefined;
      message = parsed.message || parsed.error || rawText;
    } catch {
      details = rawText;
      message = rawText;
    }
  }

  return new HyperbrowserError(message, {
    statusCode: response.statusCode,
    code,
    requestId:
      (typeof response.headers["x-request-id"] === "string"
        ? response.headers["x-request-id"]
        : undefined) ||
      (typeof response.headers["request-id"] === "string"
        ? response.headers["request-id"]
        : undefined),
    retryable: Boolean(response.statusCode && RETRYABLE_STATUS_CODES.has(response.statusCode)),
    service: "runtime",
    details,
  });
};

export const openRuntimeWebSocket = async (
  target: RuntimeTransportTarget,
  headers: Record<string, string>
): Promise<WebSocket> =>
  new Promise<WebSocket>((resolve, reject) => {
    let settled = false;

    const socket = new WebSocket(target.url, { headers });

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(normalizeWebSocketError(error));
    };

    socket.once("open", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(socket);
    });

    socket.once("unexpected-response", (_request, response) => {
      void buildHandshakeError(response).then(rejectOnce).catch(rejectOnce);
    });

    socket.once("error", rejectOnce);
  });
