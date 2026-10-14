import { performance } from "perf_hooks";
import { HyperbrowserError, ResponseDecodingError } from "../error";
import { RuntimeSSEEvent, RuntimeSSEStream, RuntimeTransport } from "./base";
import {
  DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
  normalizeProcessResult,
  ProcessOutput,
  RawProcessResult,
  validateOutputLimit,
} from "./process-output";
import {
  assertNoEnvSecretOverlap,
  assertOnePasswordAlone,
  checkVaultName,
  serializeOnePassword,
  serializeSecretReferences,
  WireOnePassword,
  WireSecretReference,
} from "./secret-references";
import {
  SandboxExecParams,
  SandboxExecOptions,
  SandboxResolvedSecret,
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

export interface RawProcessSummary extends Partial<SandboxProcessSummary> {
  id: string;
  status: SandboxProcessSummary["status"];
  command: string;
  args?: string[] | null;
  cwd: string;
  pid?: number | null;
  exit_code?: number | null;
  started_at: number;
  completed_at?: number | null;
}

/** The body of a control API process start with secrets. */
export interface SecretProcessStartPayload {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  runAs?: string;
  secrets?: Record<string, WireSecretReference>;
  /** A vault name; `secrets` is merged over its entries. */
  vault?: string;
  /** 1Password fields; their variables can't come from any other source. */
  onePassword?: WireOnePassword;
}

export interface SecretProcessStartResponse {
  /** The sandbox agent's summary, passed through unchanged. */
  process?: RawProcessSummary;
  secrets?: SandboxResolvedSecret[];
}

/** Whether a start delivers secrets, so it goes through the control API. */
const deliversSecrets = (params: SandboxExecParams): boolean =>
  params.vault !== undefined ||
  params.onePassword !== undefined ||
  (params.secrets !== undefined &&
    params.secrets !== null &&
    Object.keys(params.secrets).length > 0);

/** @internal Starts processes with secrets through the control API. */
export interface SecretProcessStarter {
  sandboxId: string;
  /** Each runtime wait stays under the runtime request timeout. */
  waitChunkMs: number;
  start(
    payload: SecretProcessStartPayload,
    signal?: AbortSignal
  ): Promise<SecretProcessStartResponse>;
}

interface SecretProcessWaitContext {
  chunkMs: number;
  signal?: AbortSignal;
}

/** Errors from connecting at all; anything else may have reached the API. */
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"]);

/** The control API's code for a secret process start it could not confirm. */
const SERVER_OUTCOME_UNKNOWN_CODE = "SECRET_PROCESS_OUTCOME_UNKNOWN";

/** The control API's limit on a secret process's `timeoutMs`. */
const MAX_SECRET_PROCESS_TIMEOUT_MS = 86_400_000;

/**
 * @internal Whether a failed control API request may still have reached the
 * API: it timed out or its response couldn't be read. API errors and failures
 * to connect are excluded.
 */
export const requestMayHaveArrived = (error: unknown): boolean => {
  if (error instanceof ResponseDecodingError) {
    return true;
  }
  if (!(error instanceof HyperbrowserError)) {
    return true;
  }
  // Pre-aborted calls are rejected before sending. Cancellation here may
  // interrupt an error body after the API has already accepted the start.
  if (error.code === "request_aborted") {
    return true;
  }
  if (error.statusCode !== undefined && error.statusCode >= 400) {
    return false;
  }
  const code = (error.cause as { code?: string } | undefined)?.code;
  return !(code && CONNECT_ERROR_CODES.has(code));
};

const DEFAULT_PROCESS_KILL_WAIT_MS = 5_000;
const SHELL_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

const normalizeProcessSummary = (process: RawProcessSummary): SandboxProcessSummary => ({
  id: process.id,
  status: process.status,
  command: process.command,
  args: process.args,
  cwd: process.cwd,
  pid: process.pid,
  exitCode: process.exit_code !== undefined ? process.exit_code : process.exitCode,
  startedAt: process.started_at ?? process.startedAt!,
  completedAt: process.completed_at !== undefined ? process.completed_at : process.completedAt,
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

/**
 * The command timeout for a secret process start, as the whole milliseconds
 * the control API accepts. Rounded, but a positive timeout stays at least 1ms
 * rather than becoming 0 (no timeout).
 */
const secretProcessTimeoutMs = (params: SandboxExecParams): number | undefined => {
  for (const name of ["timeoutSec", "timeoutMs"] as const) {
    const value = params[name];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw new HyperbrowserError(`${name} must be a non-negative number`);
    }
  }
  // Match the receiver: positive seconds take precedence over milliseconds.
  const timeoutMs = localWaitTimeoutMs(params);
  if (timeoutMs === undefined) {
    return undefined;
  }
  const wholeMs = Math.max(1, Math.round(timeoutMs));
  if (wholeMs > MAX_SECRET_PROCESS_TIMEOUT_MS) {
    throw new HyperbrowserError(
      `A process started with secrets can run for at most ${MAX_SECRET_PROCESS_TIMEOUT_MS / 1000} seconds`
    );
  }
  return wholeMs;
};

const waitTimeoutError = (): HyperbrowserError =>
  new HyperbrowserError("Timed out waiting for command output", {
    code: "wait_timeout",
    service: "runtime",
    retryable: false,
  });

const requestAbortedError = (): HyperbrowserError =>
  new HyperbrowserError("Request canceled", {
    code: "request_aborted",
    retryable: false,
    service: "runtime",
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
  private output: ProcessOutput | null = null;
  private collector: Promise<void> | null = null;
  private closeStream: (() => void) | null = null;
  private readonly changed = new ChangeSignal();

  /** What a process started with `secrets`, `vault` or `onePassword` received. */
  public readonly secrets?: SandboxResolvedSecret[];

  constructor(
    private readonly transport: RuntimeTransport,
    private summary: SandboxProcessSummary,
    secrets?: SandboxResolvedSecret[],
    private readonly secretWait?: SecretProcessWaitContext
  ) {
    this.secrets = secrets;
  }

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
    if (this.secretWait) {
      return this.waitWithSecrets(params);
    }
    return this.waitRetained(params);
  }

  /** Secret starts retain output on the receiver, so poll until the local deadline. */
  private async waitWithSecrets(params: SandboxProcessWaitParams): Promise<SandboxProcessResult> {
    const context = this.secretWait as SecretProcessWaitContext;
    const timeoutMs = localWaitTimeoutMs(params);
    const deadline = timeoutMs === undefined ? undefined : performance.now() + timeoutMs;
    for (;;) {
      if (context.signal?.aborted) throw requestAbortedError();
      const remaining = deadline === undefined ? undefined : deadline - performance.now();
      if (remaining !== undefined && remaining <= 0) throw waitTimeoutError();

      const controller = new AbortController();
      let deadlineExpired = false;
      let cancelWait!: (error: HyperbrowserError) => void;
      const canceled = new Promise<never>((_, reject) => {
        cancelWait = reject;
      });
      const abort = () => {
        controller.abort();
        cancelWait(requestAbortedError());
      };
      context.signal?.addEventListener("abort", abort, { once: true });
      // Node timers cannot represent intervals above 2^31-1 ms. Long local
      // deadlines are checked again after every bounded request instead.
      const timer =
        remaining !== undefined && remaining <= 2_147_483_647
          ? setTimeout(() => {
              deadlineExpired = true;
              controller.abort();
              cancelWait(waitTimeoutError());
            }, remaining)
          : undefined;
      try {
        const result = await Promise.race([
          this.waitRetained(
            { timeoutMs: Math.max(1, Math.floor(Math.min(context.chunkMs, remaining ?? Infinity))) },
            controller.signal
          ),
          canceled,
        ]);
        if (context.signal?.aborted) throw requestAbortedError();
        if (deadlineExpired || (deadline !== undefined && performance.now() >= deadline)) {
          throw waitTimeoutError();
        }
        return result;
      } catch (error) {
        if (context.signal?.aborted) throw requestAbortedError();
        if (deadlineExpired || (deadline !== undefined && performance.now() >= deadline)) {
          throw waitTimeoutError();
        }
        if (!(error instanceof HyperbrowserError) || error.statusCode !== 408) throw error;
      } finally {
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", abort);
      }
    }
  }

  private async waitRetained(
    params: SandboxProcessWaitParams,
    signal?: AbortSignal
  ): Promise<SandboxProcessResult> {
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
        signal,
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
  constructor(
    private readonly transport: RuntimeTransport,
    private readonly secretStarter?: SecretProcessStarter
  ) {}

  /** Run a command to completion, collecting its full output from process start. */
  async exec(command: string, options?: SandboxExecOptions): Promise<SandboxProcessResult>;
  async exec(input: SandboxExecParams): Promise<SandboxProcessResult>;
  async exec(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessResult> {
    const params = normalizeExecParams(input, options);
    if (deliversSecrets(params)) {
      return this.execWithSecrets(params);
    }
    const handle = await this.start(params);
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
    if (deliversSecrets(params)) {
      return this.startWithSecrets(params);
    }
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

  /**
   * Start through the control API so the sandbox service decrypts the
   * secrets. Output is then read through the runtime's retained output.
   */
  private async startWithSecrets(params: SandboxExecParams): Promise<SandboxProcessHandle> {
    if (params.signal?.aborted) throw requestAbortedError();
    const starter = this.secretStarter;
    if (!starter) {
      throw new HyperbrowserError("Starting a process with secrets requires a sandbox handle");
    }
    const secrets = serializeSecretReferences(params.secrets);
    const vault = params.vault === undefined ? undefined : checkVaultName(params.vault);
    const onePassword = serializeOnePassword(params.onePassword);
    // A clash between env and the vault's variables is reported by the API.
    if (secrets !== undefined) assertNoEnvSecretOverlap(params.env, secrets);
    if (onePassword !== undefined)
      assertOnePasswordAlone(onePassword, { secrets, env: params.env });
    const timeoutMs = secretProcessTimeoutMs(params);

    let response: SecretProcessStartResponse;
    try {
      response = await starter.start(
        {
          command: params.command,
          cwd: params.cwd,
          env: params.env,
          timeoutMs,
          runAs: params.runAs,
          secrets,
          vault,
          onePassword,
        },
        params.signal
      );
    } catch (error) {
      if (error instanceof HyperbrowserError && error.code === SERVER_OUTCOME_UNKNOWN_CODE) {
        // The API reached the sandbox host but could not confirm the start.
        throw new HyperbrowserError(error.message.replace(/^\[Hyperbrowser\]: /, ""), {
          statusCode: error.statusCode,
          code: "secret_process_outcome_unknown",
          requestId: error.requestId,
          retryable: false,
          service: "control",
          details: {
            ...(typeof error.details === "object" ? error.details : undefined),
            sandboxId: starter.sandboxId,
          },
          cause: error,
          method: error.method,
          path: error.path,
        });
      }
      if (!requestMayHaveArrived(error)) {
        throw error;
      }
      throw new HyperbrowserError(
        `The process start may have reached the API, but no result came back; the command may be running, so check the sandbox's processes before retrying`,
        {
          code: "secret_process_outcome_unknown",
          retryable: false,
          service: "control",
          details: { sandboxId: starter.sandboxId },
          cause: error,
        }
      );
    }
    const process = response?.process;
    const processId = process?.id;
    if (!process || typeof processId !== "string" || !processId.trim()) {
      // The start succeeded, so the command may be running with the secrets.
      throw new HyperbrowserError(
        "The API accepted the process start but returned no process ID; the command may be running, so check the sandbox's processes before retrying",
        {
          code: "secret_process_outcome_unknown",
          retryable: false,
          service: "control",
          details: { sandboxId: starter.sandboxId },
        }
      );
    }
    return new SandboxProcessHandle(
      this.transport,
      normalizeProcessSummary({ ...process, id: processId.trim() }),
      response.secrets ?? [],
      { chunkMs: starter.waitChunkMs, signal: params.signal }
    );
  }

  /**
   * Like one-shot exec: stdin is closed, then the command's final result is
   * awaited. The command's own timeout is enforced in the sandbox, so an
   * expired wait (408) only means it is still running.
   */
  private async execWithSecrets(params: SandboxExecParams): Promise<SandboxProcessResult> {
    const handle = await this.startWithSecrets(params);
    const starter = this.secretStarter as SecretProcessStarter;
    try {
      try {
        await this.transport.requestJSON(`/sandbox/processes/${handle.id}/stdin`, {
          method: "POST",
          body: JSON.stringify({ eof: true }),
          headers: { "content-type": "application/json" },
          signal: params.signal,
        });
      } catch (error) {
        // 409: the command already exited; its result is still reported.
        if (!(error instanceof HyperbrowserError) || error.statusCode !== 409) {
          throw error;
        }
      }
      return await handle.wait();
    } catch (error) {
      // Running exec again would start a second process with the secrets.
      throw new HyperbrowserError(
        `Process ${handle.id} started, but waiting for its result failed: ${
          error instanceof Error ? error.message.replace(/^\[Hyperbrowser\]: /, "") : String(error)
        }`,
        {
          code: "secret_process_failed",
          retryable: false,
          service: "runtime",
          details: { sandboxId: starter.sandboxId, processId: handle.id },
          cause: error,
        }
      );
    }
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
