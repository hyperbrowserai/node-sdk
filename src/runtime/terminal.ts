import WebSocket from "ws";
import { RuntimeTransport } from "./base";
import { AsyncEventQueue, toWebSocketUrl } from "./ws";
import {
  SandboxTerminalCreateParams,
  SandboxTerminalEvent,
  SandboxTerminalStatus,
  SandboxTerminalWaitParams,
} from "../types/sandbox";

interface PTYStatusResponse {
  pty: RawPTYStatus;
}

interface RawPTYStatus {
  id: string;
  command: string;
  args?: string[];
  cwd: string;
  pid?: number;
  running: boolean;
  exitCode?: number | null;
  error?: string;
  timedOut?: boolean;
  rows: number;
  cols: number;
  startedAt: number;
  finishedAt?: number;
}

interface RuntimeConnectionInfo {
  sandboxId: string;
  baseUrl: string;
  token: string;
}

const normalizeTerminalStatus = (pty: RawPTYStatus): SandboxTerminalStatus => ({
  id: pty.id,
  command: pty.command,
  args: pty.args,
  cwd: pty.cwd,
  pid: pty.pid,
  running: pty.running,
  exitCode: pty.exitCode,
  error: pty.error,
  timedOut: pty.timedOut,
  rows: pty.rows,
  cols: pty.cols,
  startedAt: pty.startedAt,
  finishedAt: pty.finishedAt,
});

export class SandboxTerminalConnection {
  private readonly eventsQueue = new AsyncEventQueue<SandboxTerminalEvent>();

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as
          | {
              type: "output";
              seq: number;
              data: string;
              timestamp: number;
            }
          | {
              type: "exit";
              status: RawPTYStatus;
            };

        if (parsed.type === "output") {
          const raw = Buffer.from(parsed.data, "base64");
          this.eventsQueue.push({
            type: "output",
            seq: parsed.seq,
            data: raw.toString("utf8"),
            raw,
            timestamp: parsed.timestamp,
          });
          return;
        }

        this.eventsQueue.push({
          type: "exit",
          status: normalizeTerminalStatus(parsed.status),
        });
      } catch (error) {
        this.eventsQueue.fail(error);
      }
    });

    ws.on("close", () => {
      this.eventsQueue.close();
    });

    ws.on("error", (error) => {
      this.eventsQueue.fail(error);
    });
  }

  events(): AsyncIterable<SandboxTerminalEvent> {
    return this.eventsQueue;
  }

  async write(data: string | Uint8Array): Promise<void> {
    const payload =
      typeof data === "string"
        ? {
            type: "input",
            data,
          }
        : {
            type: "input",
            data: Buffer.from(data).toString("base64"),
            encoding: "base64",
          };

    await this.send(payload);
  }

  async resize(rows: number, cols: number): Promise<void> {
    await this.send({
      type: "resize",
      rows,
      cols,
    });
  }

  async close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.CLOSING ||
      this.ws.readyState === WebSocket.CLOSED
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.send(JSON.stringify(payload), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

export class SandboxTerminalHandle {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>,
    private status: SandboxTerminalStatus
  ) {}

  get id(): string {
    return this.status.id;
  }

  get current(): SandboxTerminalStatus {
    return { ...this.status };
  }

  toJSON(): SandboxTerminalStatus {
    return { ...this.status };
  }

  async refresh(includeOutput: boolean = false): Promise<SandboxTerminalHandle> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      `/sandbox/pty/${this.id}`,
      undefined,
      includeOutput ? { includeOutput: true } : undefined
    );
    this.status = normalizeTerminalStatus(response.pty);
    return this;
  }

  async wait(
    params: SandboxTerminalWaitParams = {}
  ): Promise<SandboxTerminalStatus> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      `/sandbox/pty/${this.id}/wait`,
      {
        method: "POST",
        body: JSON.stringify({
          timeoutMs: params.timeoutMs,
          includeOutput: params.includeOutput,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
    this.status = normalizeTerminalStatus(response.pty);
    return this.current;
  }

  async kill(signal?: string): Promise<SandboxTerminalStatus> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      `/sandbox/pty/${this.id}/kill`,
      {
        method: "POST",
        body: JSON.stringify({ signal }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
    this.status = normalizeTerminalStatus(response.pty);
    return this.current;
  }

  async resize(rows: number, cols: number): Promise<SandboxTerminalStatus> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      `/sandbox/pty/${this.id}/resize`,
      {
        method: "POST",
        body: JSON.stringify({ rows, cols }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
    this.status = normalizeTerminalStatus(response.pty);
    return this.current;
  }

  async attach(): Promise<SandboxTerminalConnection> {
    const connectionInfo = await this.getConnectionInfo();
    const target = toWebSocketUrl(
      connectionInfo.baseUrl,
      `/sandbox/pty/${this.id}/ws?sessionId=${encodeURIComponent(
        connectionInfo.sandboxId
      )}`
    );

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${connectionInfo.token}`,
      };
      if (target.hostHeader) {
        headers.Host = target.hostHeader;
      }

      const socket = new WebSocket(target.url, {
        headers,
      });

      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });

    return new SandboxTerminalConnection(ws);
  }
}

export class SandboxTerminalApi {
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly getConnectionInfo: () => Promise<RuntimeConnectionInfo>
  ) {}

  async create(
    params: SandboxTerminalCreateParams
  ): Promise<SandboxTerminalHandle> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      "/sandbox/pty",
      {
        method: "POST",
        body: JSON.stringify(params),
        headers: {
          "content-type": "application/json",
        },
      }
    );

    return new SandboxTerminalHandle(
      this.transport,
      this.getConnectionInfo,
      normalizeTerminalStatus(response.pty)
    );
  }

  async get(id: string, includeOutput: boolean = false): Promise<SandboxTerminalHandle> {
    const response = await this.transport.requestJSON<PTYStatusResponse>(
      `/sandbox/pty/${id}`,
      undefined,
      includeOutput ? { includeOutput: true } : undefined
    );

    return new SandboxTerminalHandle(
      this.transport,
      this.getConnectionInfo,
      normalizeTerminalStatus(response.pty)
    );
  }
}
