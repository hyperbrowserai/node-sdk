import { Readable } from "stream";
import { StringDecoder } from "string_decoder";
import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserError } from "../error";
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
  signal?: AbortSignal;
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
  private readonly responseCleanup = new WeakMap<Response, () => void>();

  private closeResponse(response: Response): void {
    this.responseCleanup.get(response)?.();
  }

  private failure(error: unknown, path: string, init?: RequestInit, response?: Response): HyperbrowserError {
    if (error instanceof HyperbrowserError) {
      return new HyperbrowserError(error.message.replace(/^\[Hyperbrowser\]: /, ""), {
        statusCode: error.statusCode ?? response?.status,
        code: error.code,
        requestId: error.requestId ?? (response ? getRequestId(response) : undefined),
        service: error.service ?? "runtime",
        retryable: error.retryable,
        details: error.details,
        cause: error.cause ?? error,
        method: error.method ?? init?.method ?? "GET",
        path: error.path ?? path.split("?", 1)[0],
      });
    }
    const canceled = init?.signal?.aborted;
    return new HyperbrowserError(
      error instanceof Error ? error.message : "Runtime request failed",
      {
        code: canceled ? "request_aborted" : undefined,
        statusCode: response?.status,
        requestId: response ? getRequestId(response) : undefined,
        service: "runtime",
        retryable: !canceled && isRetryableNetworkError(error),
        method: init?.method ?? "GET",
        path: path.split("?", 1)[0],
        cause: error,
      }
    );
  }
  constructor(
    private readonly resolveConnection: (forceRefresh?: boolean) => Promise<RuntimeConnection>,
    private readonly timeout: number = 30000,
    private readonly runtimeProxyOverride?: string
  ) {}

  async requestJSON<T>(path: string, init?: RequestInit, params?: RuntimeParams): Promise<T> {
    const response = await this.fetchWithAuth(path, init, params);
    try {
      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch (cause) {
        throw new HyperbrowserError("Failed to parse JSON response", {
          statusCode: response.status,
          requestId: getRequestId(response),
          service: "runtime",
          cause,
          method: init?.method ?? "GET",
          path: path.split("?", 1)[0],
        });
      }
    } catch (error) {
      throw this.failure(error, path, init, response);
    } finally {
      this.closeResponse(response);
    }
  }

  async requestBuffer(path: string, init?: RequestInit, params?: RuntimeParams): Promise<Buffer> {
    const response = await this.fetchWithAuth(path, init, params);
    try {
      return await response.buffer();
    } catch (error) {
      throw this.failure(error, path, init, response);
    } finally {
      this.closeResponse(response);
    }
  }

  /** Pull-based binary transfer. Breaking iteration closes the HTTP connection. */
  async *streamBytes(
    path: string,
    init?: RequestInit,
    params?: RuntimeParams
  ): AsyncGenerator<Buffer> {
    const response = await this.fetchWithAuth(path, init, params, true, true);
    try {
      if (!response.body) return;
      const iterator = (response.body as Readable)[Symbol.asyncIterator]();
      for (;;) {
        const next = await this.readChunk(iterator, this.timeout);
        if (next.done) return;
        yield Buffer.from(next.value);
      }
    } catch (error) {
      throw this.failure(error, path, init, response);
    } finally {
      this.closeResponse(response);
    }
  }

  private readChunk<T>(iterator: AsyncIterator<T>, timeout: number): Promise<IteratorResult<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new HyperbrowserError(
              `Runtime stream idle for ${timeout}ms without data or keepalives`,
              { code: "stream_idle_timeout", service: "runtime", retryable: true }
            )
          ),
        timeout
      );
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
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    const response = await this.fetchWithAuth(
      path,
      { method, headers, body: init.body, signal: init.signal },
      params,
      true,
      true
    );
    if (method === "POST" && !isEventStream(response)) {
      this.closeResponse(response);
      throw new HyperbrowserError(
        "Receiver does not support streaming command start; update the receiver. " +
          "The command may have started; do not retry it automatically.",
        { code: "streaming_not_supported", service: "runtime", retryable: false,
          method, path: path.split("?", 1)[0], requestId: getRequestId(response), statusCode: response.status }
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
      this.closeResponse(response);
    };
    const parsed = this.parseSSE(body, idleTimeoutMs, () => closed, close, init.signal);
    const failure = (error: unknown) => this.failure(error, path, { method, signal: init.signal }, response);
    const events = (async function* () {
      try { yield* parsed; } catch (error) { throw failure(error); }
    })();
    return { events, close };
  }

  private async *parseSSE(
    body: NodeJS.ReadableStream | null,
    idleTimeoutMs: number,
    isClosed: () => boolean,
    close: () => void,
    signal?: AbortSignal
  ): AsyncGenerator<RuntimeSSEEvent> {
    if (!body) {
      return;
    }

    let buffer = "";
    let skipLineFeed = false;
    const decoder = new StringDecoder("utf8");
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

    const readLine = (line: string): RuntimeSSEEvent | null => {
      if (line === "") return flushEvent();
      if (line.startsWith(":")) return null;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      // Match the Python transport's field-value space normalization.
      const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ +/, "");
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
      }
      return null;
    };

    const iterator = (body as AsyncIterable<Buffer | string>)[Symbol.asyncIterator]();

    try {
      for (;;) {
        let next: IteratorResult<Buffer | string>;
        try {
          next = await this.readChunk(iterator, idleTimeoutMs);
        } catch (error) {
          if (signal?.aborted)
            throw new HyperbrowserError("Command collection canceled", {
              code: "request_aborted",
              service: "runtime",
              cause: error,
            });
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
        buffer += decoder.write(Buffer.from(next.value));

        while (true) {
          if (skipLineFeed) {
            if (!buffer) break;
            if (buffer.startsWith("\n")) buffer = buffer.slice(1);
            skipLineFeed = false;
          }
          const newlineIndex = buffer.search(/[\r\n]/);
          if (newlineIndex === -1) {
            break;
          }

          const line = buffer.slice(0, newlineIndex);
          // Deliver bare CR immediately; absorb a following LF even across chunks.
          skipLineFeed = buffer[newlineIndex] === "\r";
          buffer = buffer.slice(newlineIndex + 1);
          const event = readLine(line);
          if (event) yield event;
        }
      }

      buffer += decoder.end();
      if (buffer) readLine(buffer);
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
    allowRefresh: boolean = true,
    streaming: boolean = false
  ): Promise<Response> {
    const connection = await this.resolveConnection(false);
    const response = await this.fetchForConnection(connection, path, init, params, streaming);

    if (response.status === 401 && allowRefresh) {
      this.closeResponse(response);
      if (init?.body instanceof Readable) {
        throw new HyperbrowserError(
          "Runtime authentication expired during a streaming upload; obtain a new stream before retrying",
          {
            statusCode: 401,
            code: "stream_not_replayable",
            service: "runtime",
            retryable: false,
            method: init?.method ?? "GET",
            path: path.split("?", 1)[0],
            requestId: getRequestId(response),
          }
        );
      }
      const refreshed = await this.resolveConnection(true);
      const retryResponse = await this.fetchForConnection(refreshed, path, init, params, streaming);
      return this.assertResponse(retryResponse, path, init);
    }

    return this.assertResponse(response, path, init);
  }

  private async fetchForConnection(
    connection: RuntimeConnection,
    path: string,
    init?: RequestInit,
    params?: RuntimeParams,
    streaming = false
  ): Promise<Response> {
    const target = resolveRuntimeTransportTarget(
      connection.baseUrl,
      this.buildRequestPath(path, params),
      this.runtimeProxyOverride
    );
    const headers = this.buildHeaders(connection, init?.headers, target.hostHeader);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined = setTimeout(() => controller.abort(), this.timeout);
    const upload = init?.body instanceof Readable ? init.body : undefined;
    const uploadProgress = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.timeout);
    };
    upload?.on("data", uploadProgress);
    const callerSignal = init?.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const detach = () => {
      clearTimeout(timer);
      timer = undefined;
      callerSignal?.removeEventListener("abort", abortFromCaller);
      upload?.removeListener("data", uploadProgress);
    };
    try {
      const response = await fetch(target.url, { ...init, headers, signal: controller.signal });
      clearTimeout(timer);
      upload?.removeListener("data", uploadProgress);
      // Header and body budgets are separate. Streams use a read-idle budget.
      timer =
        streaming && response.ok ? undefined : setTimeout(() => controller.abort(), this.timeout);
      const body = response.body as Readable | null;
      let disposed = false;
      const close = () => {
        if (disposed) return;
        disposed = true;
        detach();
        if (!body?.readableEnded) controller.abort();
        body?.destroy();
      };
      this.responseCleanup.set(response, close);
      if (body) {
        body.once("end", detach);
        body.once("close", close);
      } else close();
      return response;
    } catch (error) {
      detach();
      throw this.failure(error, path, init);
    }
  }

  private async assertResponse(response: Response, path: string, init?: RequestInit): Promise<Response> {
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
    } catch (error) {
      if (init?.signal?.aborted) throw this.failure(error, path, init, response);
      // Keep the fallback message.
    } finally {
      this.closeResponse(response);
    }

    throw new HyperbrowserError(message, {
      statusCode: response.status,
      code,
      requestId: getRequestId(response),
      retryable: RETRYABLE_STATUS_CODES.has(response.status),
      service: "runtime",
      details,
      method: init?.method ?? "GET",
      path: path.split("?", 1)[0],
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
