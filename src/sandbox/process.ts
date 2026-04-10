import { RuntimeSSEEvent, RuntimeTransport } from "./base";
import {
  SandboxExecParams,
  SandboxExecOptions,
  SandboxProcessListParams,
  SandboxProcessListResponse,
  SandboxProcessResult,
  SandboxProcessSignal,
  SandboxProcessStdinParams,
  SandboxProcessStreamEvent,
  SandboxProcessSummary,
  SandboxProcessWaitParams,
} from "../types/sandbox";

interface ProcessSummaryResponse {
  process: RawProcessSummary;
}

interface ProcessResultResponse {
  result: RawProcessResult;
}

interface ProcessListWireResponse {
  data: RawProcessSummary[];
  next_cursor?: string;
}

interface RawProcessSummary {
  id: string;
  status: SandboxProcessSummary["status"];
  command: string;
  args?: string[];
  cwd: string;
  pid?: number;
  exit_code?: number | null;
  started_at: number;
  completed_at?: number;
}

interface RawProcessResult {
  id: string;
  status: SandboxProcessResult["status"];
  exit_code?: number | null;
  stdout: string;
  stderr: string;
  started_at: number;
  completed_at?: number;
  error?: string;
}

interface ExecResponse {
  result: RawProcessResult;
}

interface StartProcessResponse {
  process: RawProcessSummary;
}

const DEFAULT_PROCESS_KILL_WAIT_MS = 5_000;
const SHELL_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

const normalizeProcessSummary = (process: RawProcessSummary): SandboxProcessSummary => ({
  id: process.id,
  status: process.status,
  command: process.command,
  args: process.args,
  cwd: process.cwd,
  pid: process.pid,
  exitCode: process.exit_code,
  startedAt: process.started_at,
  completedAt: process.completed_at,
});

const normalizeProcessResult = (result: RawProcessResult): SandboxProcessResult => ({
  id: result.id,
  status: result.status,
  exitCode: result.exit_code,
  stdout: result.stdout,
  stderr: result.stderr,
  startedAt: result.started_at,
  completedAt: result.completed_at,
  error: result.error,
});

const normalizeResultToSummary = (result: SandboxProcessResult): SandboxProcessSummary => ({
  id: result.id,
  status: result.status,
  command: "",
  cwd: "",
  exitCode: result.exitCode,
  startedAt: result.startedAt,
  completedAt: result.completedAt,
});

const normalizeStreamEvent = (event: RuntimeSSEEvent): SandboxProcessStreamEvent | null => {
  if (event.event === "output") {
    const payload = event.data as {
      seq: number;
      stream: "stdout" | "stderr" | "system";
      data: string;
      timestamp: number;
    };

    return {
      type: payload.stream,
      seq: payload.seq,
      data: payload.data,
      timestamp: payload.timestamp,
    };
  }

  if (event.event === "done") {
    return {
      type: "exit",
      result: normalizeProcessResult(event.data as RawProcessResult),
    };
  }

  return null;
};

const quoteShellToken = (token: string): string => {
  if (token.length === 0) {
    return "''";
  }

  return SHELL_SAFE_TOKEN_PATTERN.test(token) ? token : `'${token.replace(/'/g, `'"'"'`)}'`;
};

const buildShellCommand = (command: string, args?: string[]): string => {
  if (!args || args.length === 0) {
    return command;
  }

  return [command, ...args].map((token) => quoteShellToken(token)).join(" ");
};

const normalizeLegacyProcessParams = (input: SandboxExecParams): SandboxExecParams => ({
  ...input,
  command: buildShellCommand(input.command, input.args),
  args: undefined,
  useShell: undefined,
});

const buildProcessPayload = (input: SandboxExecParams) => ({
  command: input.command,
  cwd: input.cwd,
  env: input.env,
  timeoutMs: input.timeoutMs,
  timeout_sec: input.timeoutSec,
  runAs: input.runAs,
});

const normalizeExecParams = (
  input: string | SandboxExecParams,
  options?: SandboxExecOptions
): SandboxExecParams =>
  typeof input === "string"
    ? normalizeLegacyProcessParams({
        command: input,
        ...options,
      })
    : normalizeLegacyProcessParams(input);

const encodeStdinPayload = (input: SandboxProcessStdinParams) => {
  if (input.data === undefined) {
    return {
      eof: input.eof,
    };
  }

  if (typeof input.data === "string") {
    return {
      data: input.data,
      encoding: input.encoding || "utf8",
      eof: input.eof,
    };
  }

  return {
    data: Buffer.from(input.data).toString("base64"),
    encoding: "base64",
    eof: input.eof,
  };
};

export class SandboxProcessHandle {
  constructor(
    private readonly transport: RuntimeTransport,
    private summary: SandboxProcessSummary
  ) {}

  get id(): string {
    return this.summary.id;
  }

  get status(): SandboxProcessSummary["status"] {
    return this.summary.status;
  }

  toJSON(): SandboxProcessSummary {
    return { ...this.summary };
  }

  async refresh(): Promise<SandboxProcessHandle> {
    const response = await this.transport.requestJSON<ProcessSummaryResponse>(
      `/sandbox/processes/${this.id}`
    );
    this.summary = normalizeProcessSummary(response.process);
    return this;
  }

  async wait(params: SandboxProcessWaitParams = {}): Promise<SandboxProcessResult> {
    const response = await this.transport.requestJSON<ProcessResultResponse>(
      `/sandbox/processes/${this.id}/wait`,
      {
        method: "POST",
        body: JSON.stringify({
          timeoutMs: params.timeoutMs,
          timeout_sec: params.timeoutSec,
        }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
    const result = normalizeProcessResult(response.result);
    this.summary = {
      ...this.summary,
      ...normalizeResultToSummary(result),
      command: this.summary.command,
      args: this.summary.args,
      cwd: this.summary.cwd,
      pid: this.summary.pid,
    };
    return result;
  }

  async signal(signal: SandboxProcessSignal): Promise<void> {
    const response = await this.transport.requestJSON<ProcessSummaryResponse>(
      `/sandbox/processes/${this.id}/signal`,
      {
        method: "POST",
        body: JSON.stringify({ signal }),
        headers: {
          "content-type": "application/json",
        },
      }
    );
    this.summary = normalizeProcessSummary(response.process);
  }

  async kill(params: SandboxProcessWaitParams = {}): Promise<SandboxProcessResult> {
    const response = await this.transport.requestJSON<ProcessSummaryResponse>(
      `/sandbox/processes/${this.id}`,
      {
        method: "DELETE",
      }
    );
    this.summary = normalizeProcessSummary(response.process);
    const waitParams: SandboxProcessWaitParams =
      params.timeoutMs !== undefined
        ? {
            timeoutMs: params.timeoutMs,
            timeoutSec: params.timeoutSec,
          }
        : params.timeoutSec !== undefined
          ? {
              timeoutSec: params.timeoutSec,
            }
          : {
              timeoutMs: DEFAULT_PROCESS_KILL_WAIT_MS,
            };
    return this.wait({
      ...waitParams,
    });
  }

  async writeStdin(input: string | Uint8Array | SandboxProcessStdinParams): Promise<void> {
    const payload =
      typeof input === "string" || input instanceof Uint8Array
        ? encodeStdinPayload({ data: input })
        : encodeStdinPayload(input);

    await this.transport.requestJSON<{ success: boolean }>(`/sandbox/processes/${this.id}/stdin`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
    });
  }

  async *stream(fromSeq?: number): AsyncGenerator<SandboxProcessStreamEvent> {
    const params =
      fromSeq && fromSeq > 0
        ? {
            from_seq: fromSeq,
          }
        : undefined;

    for await (const event of this.transport.streamSSE(
      `/sandbox/processes/${this.id}/stream`,
      params
    )) {
      const normalized = normalizeStreamEvent(event);
      if (normalized) {
        yield normalized;
      }
    }
  }

  async result(): Promise<SandboxProcessResult> {
    return this.wait();
  }
}

export class SandboxProcessesApi {
  constructor(private readonly transport: RuntimeTransport) {}

  async exec(command: string, options?: SandboxExecOptions): Promise<SandboxProcessResult>;
  async exec(input: SandboxExecParams): Promise<SandboxProcessResult>;
  async exec(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessResult> {
    const params = normalizeExecParams(input, options);
    const response = await this.transport.requestJSON<ExecResponse>("/sandbox/exec", {
      method: "POST",
      body: JSON.stringify(buildProcessPayload(params)),
      headers: {
        "content-type": "application/json",
      },
    });

    return normalizeProcessResult(response.result);
  }

  async start(command: string, options?: SandboxExecOptions): Promise<SandboxProcessHandle>;
  async start(input: SandboxExecParams): Promise<SandboxProcessHandle>;
  async start(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessHandle> {
    const params = normalizeExecParams(input, options);
    const response = await this.transport.requestJSON<StartProcessResponse>("/sandbox/processes", {
      method: "POST",
      body: JSON.stringify(buildProcessPayload(params)),
      headers: {
        "content-type": "application/json",
      },
    });

    return new SandboxProcessHandle(this.transport, normalizeProcessSummary(response.process));
  }

  async get(processId: string): Promise<SandboxProcessHandle> {
    const response = await this.transport.requestJSON<ProcessSummaryResponse>(
      `/sandbox/processes/${processId}`
    );

    return new SandboxProcessHandle(this.transport, normalizeProcessSummary(response.process));
  }

  async list(params: SandboxProcessListParams = {}): Promise<SandboxProcessListResponse> {
    const status = Array.isArray(params.status)
      ? params.status.length > 0
        ? params.status.join(",")
        : undefined
      : params.status;

    const response = await this.transport.requestJSON<ProcessListWireResponse>(
      "/sandbox/processes",
      undefined,
      {
        status,
        limit: params.limit,
        cursor: params.cursor,
        created_after: params.createdAfter,
        created_before: params.createdBefore,
      }
    );

    return {
      data: response.data.map(normalizeProcessSummary),
      nextCursor: response.next_cursor || undefined,
    };
  }
}
