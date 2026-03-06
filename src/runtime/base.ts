import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserError } from "../client";

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

export class RuntimeTransport {
  constructor(
    private readonly resolveConnection: (
      forceRefresh?: boolean
    ) => Promise<RuntimeConnection>,
    private readonly timeout: number = 30000
  ) {}

  async requestJSON<T>(
    path: string,
    init?: RequestInit,
    params?: RuntimeParams
  ): Promise<T> {
    const response = await this.fetchWithAuth(path, init, params);
    if (response.headers.get("content-length") === "0") {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new HyperbrowserError("Failed to parse JSON response", response.status);
    }
  }

  async requestBuffer(
    path: string,
    init?: RequestInit,
    params?: RuntimeParams
  ): Promise<Buffer> {
    const response = await this.fetchWithAuth(path, init, params);
    return response.buffer();
  }

  async *streamSSE(
    path: string,
    params?: RuntimeParams
  ): AsyncGenerator<RuntimeSSEEvent> {
    const response = await this.fetchWithAuth(
      path,
      {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
        },
      },
      params
    );

    const body = response.body;
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

    for await (const chunk of body) {
      buffer += Buffer.from(chunk).toString("utf8");

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
        const value =
          separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

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
      const retryResponse = await this.fetchForConnection(
        refreshed,
        path,
        init,
        params
      );
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
    const url = new URL(path, this.normalizeBaseUrl(connection.baseUrl));
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers = this.buildHeaders(connection, init?.headers);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url.toString(), {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        error instanceof Error ? error.message : "Unknown runtime request error"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async assertResponse(response: Response): Promise<Response> {
    if (response.ok) {
      return response;
    }

    let message = `Runtime request failed: ${response.status} ${response.statusText}`;
    try {
      const rawText = await response.text();
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText) as { error?: string; message?: string };
          message = parsed.message || parsed.error || rawText;
        } catch {
          message = rawText;
        }
      }
    } catch {
      // Keep the fallback message.
    }

    throw new HyperbrowserError(message, response.status);
  }

  private buildHeaders(
    connection: RuntimeConnection,
    rawHeaders?: RequestInit["headers"]
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

    return headers;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }
}
