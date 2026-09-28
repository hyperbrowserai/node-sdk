import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserError } from "../client";
import { isRetryableNetworkError, RETRYABLE_STATUS_CODES } from "../retry";
import { resolveRuntimeTransportTarget } from "./ws";

export interface RuntimeConnection {
  sandboxId: string;
  baseUrl: string;
  token: string;
  directSessionHeader?: boolean;
}

export interface RuntimeSSEEvent {
  event: string;
  data: unknown;
  id?: string;
}

type RuntimeParams = Record<string, string | number | boolean | undefined>;

// The receiver sends process SSE keepalives every 15 seconds.
export const PROCESS_STREAM_IDLE_TIMEOUT_MS = 60_000;

export interface RuntimeSSEInit {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Milliseconds without any bytes before the stream fails. Defaults to 60s. */
  idleTimeoutMs?: number;
}

export interface RuntimeSSEStream {
  events: AsyncGenerator<RuntimeSSEEvent>;
  /** Close the underlying connection; the remote process keeps running. */
  close(): void;
}

const getRequestId = (response: Response): string | undefined => {
  return response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
};

const isEventStream = (response: Response): boolean =>
  (response.headers.get("content-type") || "").includes("text/event-stream");

export class RuntimeTransport {
  constructor(
    private readonly resolveConnection: (forceRefresh?: boolean) => Promise<RuntimeConnection>,
    private readonly timeout: number = 30000,
    private readonly runtimeProxyOverride?: string
  ) {}

  async requestJSON<T>(path: string, init?: RequestInit, params?: RuntimeParams): Promise<T> {
    const response = await this.fetchWithAuth(path, init, params);
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
        service: "runtime",
      });
    }
  }

  async requestBuffer(path: string, init?: RequestInit, params?: RuntimeParams): Promise<Buffer> {
    const response = await this.fetchWithAuth(path, init, params);
    return response.buffer();
  }

  async *streamSSE(path: string, params?: RuntimeParams): AsyncGenerator<RuntimeSSEEvent> {
    const stream = await this.openSSE(path, params);
    try {
      yield* stream.events;
    } finally {
      stream.close();
    }
  }

  /**
   * Open a server-sent event stream. POST streams carry a JSON body and
   * require an event-stream response, since the request may have side effects
   * that must not be retried blindly.
   */
  async openSSE(
    path: string,
    params?: RuntimeParams,
    init: RuntimeSSEInit = {}
  ): Promise<RuntimeSSEStream> {
    const method = init.method ?? "GET";
    const controller = new AbortController();
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    const response = await this.fetchWithAuth(
      path,
      { method, headers, body: init.body, signal: controller.signal },
      params
    );
    if (method === "POST" && !isEventStream(response)) {
      controller.abort();
      throw new HyperbrowserError(
        "Receiver does not support streaming command start; update the receiver. " +
          "The command may have started; do not retry it automatically.",
        { code: "streaming_not_supported", service: "runtime", retryable: false }
      );
    }
    const body = response.body;
    const idleTimeoutMs = init.idleTimeoutMs ?? PROCESS_STREAM_IDLE_TIMEOUT_MS;
    let closed = false;
    const close = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      controller.abort();
      if (
        body &&
        typeof (body as NodeJS.ReadableStream & { destroy?: () => void }).destroy === "function"
      ) {
        (body as NodeJS.ReadableStream & { destroy: () => void }).destroy();
      }
    };
    const events = this.parseSSE(body, idleTimeoutMs, () => closed, close);
    return { events, close };
  }

  private async *parseSSE(
    body: NodeJS.ReadableStream | null,
    idleTimeoutMs: number,
    isClosed: () => boolean,
    close: () => void
  ): AsyncGenerator<RuntimeSSEEvent> {
    if (!body) {
      return;
    }

    let buffer = "";
    let eventName = "message";
    let eventId: string | undefined;
    let dataLines: string[] = [];

    const flushEvent = (): RuntimeSSEEvent | null => {
      if (dataLines.length === 0 && eventName === "message" && eventId === undefined) {
        return null;
      }

      const rawData = dataLines.join("\n");
      let data: unknown = rawData;
      if (rawData) {
        try {
          data = JSON.parse(rawData);
        } catch {
          data = rawData;
        }
      }

      const event = {
        event: eventName,
        data,
        id: eventId,
      };

      eventName = "message";
      eventId = undefined;
      dataLines = [];
      return event;
    };

    const iterator = (body as AsyncIterable<Buffer | string>)[Symbol.asyncIterator]();
    const readChunk = (): Promise<IteratorResult<Buffer | string>> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          close();
          reject(
            new HyperbrowserError(
              `Runtime stream idle for ${idleTimeoutMs}ms without data or keepalives`,
              { code: "stream_idle_timeout", service: "runtime", retryable: true }
            )
          );
        }, idleTimeoutMs);
        iterator.next().then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          }
        );
      });

    try {
      for (;;) {
        let next: IteratorResult<Buffer | string>;
        try {
          next = await readChunk();
        } catch (error) {
          if (isClosed()) {
            return;
          }
          if (error instanceof HyperbrowserError) {
            throw error;
          }
          throw new HyperbrowserError(
            error instanceof Error ? error.message : "Runtime stream failed",
            { service: "runtime", retryable: isRetryableNetworkError(error), cause: error }
          );
        }
        if (next.done) {
          break;
        }
        buffer += Buffer.from(next.value).toString("utf8");

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }

          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line === "") {
            const event = flushEvent();
            if (event) {
              yield event;
            }
            continue;
          }

          if (line.startsWith(":")) {
            continue;
          }

          const separator = line.indexOf(":");
          const field = separator === -1 ? line : line.slice(0, separator);
          const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

          switch (field) {
            case "event":
              eventName = value || "message";
              break;
            case "data":
              dataLines.push(value);
              break;
            case "id":
              eventId = value;
              break;
            default:
              break;
          }
        }
      }

      const trailing = flushEvent();
      if (trailing) {
        yield trailing;
      }
    } finally {
      close();
    }
  }

  private async fetchWithAuth(
    path: string,
    init?: RequestInit,
    params?: RuntimeParams,
    allowRefresh: boolean = true
  ): Promise<Response> {
    const connection = await this.resolveConnection(false);
    const response = await this.fetchForConnection(connection, path, init, params);

    if (response.status === 401 && allowRefresh) {
      const refreshed = await this.resolveConnection(true);
      const retryResponse = await this.fetchForConnection(refreshed, path, init, params);
      return this.assertResponse(retryResponse);
    }

    return this.assertResponse(response);
  }

  private async fetchForConnection(
    connection: RuntimeConnection,
    path: string,
    init?: RequestInit,
    params?: RuntimeParams
  ): Promise<Response> {
    const target = resolveRuntimeTransportTarget(
      connection.baseUrl,
      this.buildRequestPath(path, params),
      this.runtimeProxyOverride
    );
    const headers = this.buildHeaders(connection, init?.headers, target.hostHeader);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const callerSignal = init?.signal as AbortSignal | null | undefined;
    const abortFromCaller = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", abortFromCaller, { once: true });
      }
    }

    try {
      return await fetch(target.url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown runtime request error",
        {
          retryable: isRetryableNetworkError(error),
          service: "runtime",
          cause: error,
        }
      );
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async assertResponse(response: Response): Promise<Response> {
    if (response.ok) {
      return response;
    }

    let message = `Runtime request failed: ${response.status} ${response.statusText}`;
    let details: unknown;
    let code: string | undefined;
    try {
      const rawText = await response.text();
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
    } catch {
      // Keep the fallback message.
    }

    throw new HyperbrowserError(message, {
      statusCode: response.status,
      code,
      requestId: getRequestId(response),
      retryable: RETRYABLE_STATUS_CODES.has(response.status),
      service: "runtime",
      details,
    });
  }

  private buildHeaders(
    connection: RuntimeConnection,
    rawHeaders?: RequestInit["headers"],
    hostHeader?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${connection.token}`,
    };

    if (connection.directSessionHeader) {
      headers["x-session-id"] = connection.sandboxId;
    }

    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (value !== undefined) {
          headers[key] = String(value);
        }
      }
    }

    if (hostHeader && headers.host === undefined && headers.Host === undefined) {
      headers.Host = hostHeader;
    }

    return headers;
  }

  private buildRequestPath(path: string, params?: RuntimeParams): string {
    const trimmed = path.trim();
    const [rawPath, rawQuery = ""] = trimmed.split("?", 2);
    const queryParams = new URLSearchParams(rawQuery);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      }
    }

    const query = queryParams.toString();
    return query ? `${rawPath}?${query}` : rawPath;
  }
}
