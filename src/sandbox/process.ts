import { HyperbrowserError } from "../error";
import { RuntimeSSEEvent, RuntimeSSEStream, RuntimeTransport } from "./base";
import {
  DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
  normalizeProcessResult,
  ProcessOutput,
  RawProcessResult,
  validateOutputLimit,
} from "./process-output";
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

class ChangeSignal {
  private waiters: Array<() => void> = [];

  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /** Resolve true on the next notification, or false once `timeoutMs` elapses. */
  wait(timeoutMs?: number): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const onChange = () => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(true);
      };
      this.waiters.push(onChange);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.waiters = this.waiters.filter((waiter) => waiter !== onChange);
          resolve(false);
        }, timeoutMs);
      }
    });
  }
}

const localWaitTimeoutMs = (params: SandboxProcessWaitParams): number | undefined => {
  if (params.timeoutSec !== undefined && params.timeoutSec > 0) {
    return params.timeoutSec * 1000;
  }
  if (params.timeoutMs !== undefined && params.timeoutMs > 0) {
    return params.timeoutMs;
  }
  return undefined;
};

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
  private output: ProcessOutput | null = null;
  private collector: Promise<void> | null = null;
  private closeStream: (() => void) | null = null;
  private readonly changed = new ChangeSignal();

  constructor(
    private readonly transport: RuntimeTransport,
    private summary: SandboxProcessSummary
  ) {}

  /** @internal Collect output from the start-stream that created this process. */
  attachCollector(stream: RuntimeSSEStream, maxOutputBytes: number): void {
    this.output = new ProcessOutput(this.id, maxOutputBytes);
    this.closeStream = stream.close;
    this.collector = this.collect(stream.events);
  }

  private async collect(events: AsyncGenerator<RuntimeSSEEvent>): Promise<void> {
    const output = this.output as ProcessOutput;
    try {
      for await (const event of events) {
        if (output.error !== null) {
          return;
        }
        output.consume(event);
        this.changed.notify();
        if (output.result !== null) {
          return;
        }
      }
      output.error = output.failure("Command stream ended before its completion event");
    } catch (error) {
      if (output.error === null) {
        output.error =
          error instanceof HyperbrowserError
            ? error
            : output.failure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      try {
        await events.return(undefined);
      } catch (error) {
        if (output.result === null && output.error === null) {
          output.error = output.failure(error instanceof Error ? error.message : String(error));
        }
      }
      this.closeStream?.();
      this.changed.notify();
    }
  }

  private collectedResult(): SandboxProcessResult {
    const output = this.output as ProcessOutput;
    if (output.error !== null) {
      throw output.error;
    }
    if (output.result === null) {
      throw output.failure("Command stream ended before its completion event");
    }
    const result = output.result;
    this.summary = {
      ...this.summary,
      status: result.status,
      exitCode: result.exitCode,
      completedAt: result.completedAt,
    };
    return result;
  }

  /** Stop collecting output; the detached command continues running. */
  disconnect(): void {
    if (this.output !== null) {
      if (this.output.result === null && this.output.error === null) {
        this.output.error = this.output.failure("Command output collection disconnected");
      }
      this.changed.notify();
      this.closeStream?.();
    }
  }

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

  /**
   * Wait for completion. Processes started by this client resolve from the
   * collected stream; a local timeout rejects without stopping collection.
   */
  async wait(params: SandboxProcessWaitParams = {}): Promise<SandboxProcessResult> {
    if (this.output !== null && this.collector !== null) {
      const output = this.output;
      const timeoutMs = localWaitTimeoutMs(params);
      const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
      while (output.result === null && output.error === null) {
        const remaining = deadline === undefined ? undefined : deadline - Date.now();
        const ready =
          remaining !== undefined && remaining <= 0 ? false : await this.changed.wait(remaining);
        if (!ready) {
          throw new HyperbrowserError("Timed out waiting for command output", {
            code: "wait_timeout",
            service: "runtime",
            retryable: false,
          });
        }
      }
      return this.collectedResult();
    }
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
    if (result.outputTruncated) {
      throw new ProcessOutput(this.id, 0).failure(
        "Retained process output is incomplete; collect output from process start"
      );
    }
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

  /**
   * Replay and follow output. Processes started by this client stream from the
   * collected events; other handles attach to the receiver's stream endpoint.
   */
  async *stream(fromSeq?: number): AsyncGenerator<SandboxProcessStreamEvent> {
    if (this.output !== null) {
      const output = this.output;
      let index = 0;
      for (;;) {
        const events = output.events.slice(index);
        index += events.length;
        const done = output.result !== null || output.error !== null;
        if (events.length === 0 && !done) {
          await this.changed.wait();
          continue;
        }
        for (const event of events) {
          if (fromSeq === undefined || event.seq >= fromSeq) {
            yield event;
          }
        }
        if (done) {
          yield { type: "exit", result: this.collectedResult() };
          return;
        }
      }
    }
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

  /** Run a command to completion, collecting its full output from process start. */
  async exec(command: string, options?: SandboxExecOptions): Promise<SandboxProcessResult>;
  async exec(input: SandboxExecParams): Promise<SandboxProcessResult>;
  async exec(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessResult> {
    const handle =
      typeof input === "string" ? await this.start(input, options) : await this.start(input);
    try {
      return await handle.wait();
    } finally {
      handle.disconnect();
    }
  }

  /**
   * Start a process and collect its output in the background from the same
   * streamed request, so output is complete even beyond the receiver's replay
   * limit. Call `disconnect()` to stop collecting without killing the process.
   */
  async start(command: string, options?: SandboxExecOptions): Promise<SandboxProcessHandle>;
  async start(input: SandboxExecParams): Promise<SandboxProcessHandle>;
  async start(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessHandle> {
    const params = normalizeExecParams(input, options);
    const maxOutputBytes = params.maxOutputBytes ?? DEFAULT_MAX_PROCESS_OUTPUT_BYTES;
    validateOutputLimit(maxOutputBytes);
    const stream = await this.transport.openSSE("/sandbox/processes", undefined, {
      method: "POST",
      body: JSON.stringify(buildProcessPayload(params)),
      signal: params.signal,
    });
    let handle: SandboxProcessHandle;
    try {
      const started = await stream.events.next();
      if (started.done || started.value.event !== "started") {
        throw new HyperbrowserError("Expected process start event", {
          service: "runtime",
          retryable: false,
        });
      }
      handle = new SandboxProcessHandle(
        this.transport,
        normalizeProcessSummary(started.value.data as RawProcessSummary)
      );
    } catch (error) {
      stream.close();
      await stream.events.return(undefined).catch(() => undefined);
      throw error;
    }
    handle.attachCollector(stream, maxOutputBytes);
    return handle;
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
