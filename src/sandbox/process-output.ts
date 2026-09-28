/** Collection and validation of the receiver's command event stream. */

import { StringDecoder } from "string_decoder";
import { HyperbrowserError } from "../error";
import { SandboxProcessOutputEvent, SandboxProcessResult } from "../types/sandbox";
import { RuntimeSSEEvent } from "./base";

export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

type OutputStream = "stdout" | "stderr" | "system";

interface RawOutputEvent {
  seq: number;
  stream: OutputStream;
  data: string;
  encoding?: string;
  timestamp: number;
}

export interface RawProcessResult {
  id: string;
  status: SandboxProcessResult["status"];
  exit_code?: number | null;
  stdout: string;
  stderr: string;
  started_at: number;
  completed_at?: number;
  error?: string;
  output_truncated?: boolean;
  last_seq?: number;
}

export const normalizeProcessResult = (result: RawProcessResult): SandboxProcessResult => ({
  id: result.id,
  status: result.status,
  exitCode: result.exit_code,
  stdout: result.stdout,
  stderr: result.stderr,
  startedAt: result.started_at,
  completedAt: result.completed_at,
  error: result.error,
  outputTruncated: result.output_truncated,
  lastSeq: result.last_seq,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class ProcessOutput {
  size = 0;
  seq = 0;
  readonly events: SandboxProcessOutputEvent[] = [];
  result: SandboxProcessResult | null = null;
  error: HyperbrowserError | null = null;
  private readonly chunks: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
  private readonly decoders: Record<OutputStream, StringDecoder> = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
    system: new StringDecoder("utf8"),
  };

  constructor(
    readonly processId: string,
    readonly maxBytes: number
  ) {}

  failure(message: string, code = "incomplete_output"): HyperbrowserError {
    return new HyperbrowserError(message, {
      code,
      service: "runtime",
      retryable: false,
      details: { process_id: this.processId, last_seq: this.seq },
    });
  }

  consume(event: RuntimeSSEEvent): void {
    if (event.event === "output") {
      this.consumeOutput(event.data);
      return;
    }
    if (event.event === "done") {
      this.consumeDone(event.data);
      return;
    }
    if (event.event === "error") {
      const data = isRecord(event.data) ? event.data : {};
      throw this.failure(
        String(data.error ?? "Command stream failed"),
        typeof data.code === "string" ? data.code : "incomplete_output"
      );
    }
  }

  private decodePayload(data: RawOutputEvent): Buffer {
    if (data.encoding === "base64") {
      const text = data.data;
      if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
        throw this.failure("Command output contains invalid base64 data");
      }
      return Buffer.from(text, "base64");
    }
    return Buffer.from(data.data, "utf8");
  }

  private consumeOutput(payload: unknown): void {
    if (!isRecord(payload)) {
      throw this.failure("Command output event is malformed");
    }
    const data = payload as unknown as RawOutputEvent;
    if (data.seq !== this.seq + 1) {
      throw this.failure("Command output contains a sequence gap");
    }
    const stream = data.stream;
    if (!(stream in this.decoders)) {
      throw this.failure("Unknown command output stream");
    }
    const raw = this.decodePayload(data);
    this.size += raw.length;
    if (this.size > this.maxBytes) {
      throw this.failure(
        "Command output exceeds maxOutputBytes; increase the collection limit or disconnect a detached process",
        "output_limit_exceeded"
      );
    }
    this.seq = data.seq;
    const text = this.decoders[stream].write(raw);
    this.chunks[stream === "stdout" ? "stdout" : "stderr"].push(text);
    this.events.push({ type: stream, seq: this.seq, data: text, timestamp: data.timestamp });
  }

  private consumeDone(payload: unknown): void {
    if (!isRecord(payload)) {
      throw this.failure("Command completion event is malformed");
    }
    const data = payload as unknown as RawProcessResult;
    if (data.last_seq !== this.seq || data.output_truncated) {
      throw this.failure("Receiver reported incomplete command output");
    }
    for (const stream of Object.keys(this.decoders) as OutputStream[]) {
      this.chunks[stream === "stdout" ? "stdout" : "stderr"].push(this.decoders[stream].end());
    }
    this.result = normalizeProcessResult({
      ...data,
      stdout: this.chunks.stdout.join(""),
      stderr: this.chunks.stderr.join(""),
    });
  }
}

export const validateOutputLimit = (value: unknown): void => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HyperbrowserError("maxOutputBytes must be a positive integer");
  }
};
