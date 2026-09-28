import { describe, expect, test } from "vitest";
import { HyperbrowserError } from "../../src/client";
import type { RuntimeSSEEvent, RuntimeSSEInit, RuntimeSSEStream, RuntimeTransport } from "../../src/sandbox/base";
import { SandboxProcessesApi } from "../../src/sandbox/process";

const output = (seq: number, data: Buffer, stream = "stdout"): RuntimeSSEEvent => ({
  event: "output",
  data: { seq, stream, data: data.toString("base64"), encoding: "base64", timestamp: 1 },
});

const done = (seq: number, extra: Record<string, unknown> = {}): RuntimeSSEEvent => ({
  event: "done",
  data: {
    id: "p1",
    status: "exited",
    exit_code: 7,
    started_at: 1,
    completed_at: 2,
    last_seq: seq,
    ...extra,
  },
});

const STARTED: RuntimeSSEEvent = {
  event: "started",
  data: { id: "p1", status: "running", command: "test", cwd: "/tmp", started_at: 1 },
};

class Gate {
  private resolve: (() => void) | null = null;
  readonly promise = new Promise<void>((resolve) => {
    this.resolve = resolve;
  });
  open(): void {
    this.resolve?.();
  }
}

class FakeTransport {
  calls: Array<{ path: string; init: RuntimeSSEInit }> = [];
  closed = false;
  gate: Gate | null = null;

  constructor(private events: RuntimeSSEEvent[]) {}

  async openSSE(path: string, _params: unknown, init: RuntimeSSEInit = {}): Promise<RuntimeSSEStream> {
    this.calls.push({ path, init });
    const transport = this;
    let closed = false;
    const events = (async function* () {
      try {
        yield STARTED;
        if (transport.gate) {
          await Promise.race([transport.gate.promise, new Promise<void>((resolve) => {
            const timer = setInterval(() => {
              if (closed) {
                clearInterval(timer);
                resolve();
              }
            }, 5);
          })]);
          if (closed) {
            return;
          }
        }
        for (const event of transport.events) {
          if (closed) {
            return;
          }
          yield event;
        }
      } finally {
        transport.closed = true;
      }
    })();
    return {
      events,
      close: () => {
        closed = true;
        transport.closed = true;
      },
    };
  }

  asTransport(): RuntimeTransport {
    return this as unknown as RuntimeTransport;
  }
}

const largeOutput = (): { events: RuntimeSSEEvent[]; expected: string } => {
  const chunk = Buffer.alloc(32768, "x");
  const events = Array.from({ length: 160 }, (_, i) => output(i + 1, chunk));
  events.push(
    output(161, Buffer.from([0xe2])),
    output(162, Buffer.from([0x82, 0xac])),
    output(163, Buffer.from("error"), "stderr"),
    done(163)
  );
  return { events, expected: "x".repeat(160 * chunk.length) + "€" };
};

describe("sandbox process output collection", () => {
  test("collects large output and streams from the same request", async () => {
    const { events, expected } = largeOutput();
    const transport = new FakeTransport(events);
    const handle = await new SandboxProcessesApi(transport.asTransport()).start("test");
    const result = await handle.wait({ timeoutSec: 5 });
    expect([result.stdout, result.stderr, result.exitCode]).toEqual([expected, "error", 7]);
    expect(handle.status).toBe("exited");
    const streamed = [];
    for await (const event of handle.stream()) {
      streamed.push(event);
    }
    expect(
      streamed
        .filter((e) => e.type === "stdout")
        .map((e) => (e.type === "stdout" ? e.data : ""))
        .join("")
    ).toBe(expected);
    const last = streamed[streamed.length - 1];
    expect(last.type === "exit" && last.result).toEqual(result);
    handle.disconnect();
    expect(transport.closed).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].path).toBe("/sandbox/processes");
    expect(transport.calls[0].init.method).toBe("POST");
    expect(JSON.parse(transport.calls[0].init.body ?? "")).toEqual({ command: "test" });
  });

  test.each([
    [[output(2, Buffer.from("gap")), done(2)], 100, "incomplete_output"],
    [[output(1, Buffer.from("no completion"))], 100, "incomplete_output"],
    [[output(1, Buffer.from("tail missing")), done(2)], 100, "incomplete_output"],
    [[done(0, { output_truncated: true })], 100, "incomplete_output"],
    [[output(1, Buffer.from("too much")), done(1)], 4, "output_limit_exceeded"],
  ])("incomplete output is not success or re-executed (%#)", async (events, limit, code) => {
    const transport = new FakeTransport(events as RuntimeSSEEvent[]);
    const error = await new SandboxProcessesApi(transport.asTransport())
      .exec("test", { maxOutputBytes: limit as number })
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    const failure = error as HyperbrowserError;
    expect(failure.code).toBe(code);
    expect((failure.details as Record<string, unknown>).process_id).toBe("p1");
    expect(failure.retryable).toBe(false);
    expect(transport.closed).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  test("wait timeout keeps the collector alive", async () => {
    const transport = new FakeTransport([output(1, Buffer.from("later")), done(1)]);
    transport.gate = new Gate();
    const handle = await new SandboxProcessesApi(transport.asTransport()).start("test");
    await expect(handle.wait({ timeoutMs: 1 })).rejects.toMatchObject({ code: "wait_timeout" });
    expect(transport.closed).toBe(false);
    transport.gate.open();
    expect((await handle.wait()).stdout).toBe("later");
  });

  test("disconnect closes the stream without killing the command", async () => {
    const transport = new FakeTransport([]);
    transport.gate = new Gate();
    const handle = await new SandboxProcessesApi(transport.asTransport()).start("test");
    handle.disconnect();
    expect(transport.closed).toBe(true);
    await expect(handle.wait()).rejects.toThrow(/disconnected/);
    expect(transport.calls).toHaveLength(1);
  });

  test("a stream that ends before its completion event is incomplete", async () => {
    const transport = new FakeTransport([output(1, Buffer.from("partial"))]);
    const handle = await new SandboxProcessesApi(transport.asTransport()).start("test");
    await expect(handle.wait()).rejects.toMatchObject({ code: "incomplete_output" });
  });

  test.each([0, -1, 1.5, NaN])("invalid collection limit %s is rejected before start", async (limit) => {
    const transport = new FakeTransport([]);
    await expect(
      new SandboxProcessesApi(transport.asTransport()).start("test", { maxOutputBytes: limit })
    ).rejects.toThrow(/positive integer/);
    expect(transport.calls).toHaveLength(0);
  });

  test("a non-started first event fails and closes the stream", async () => {
    const transport = new FakeTransport([]);
    transport.openSSE = async (path, _params, init = {}) => {
      transport.calls.push({ path, init });
      const events = (async function* () {
        yield { event: "output", data: {} } as RuntimeSSEEvent;
      })();
      return { events, close: () => (transport.closed = true) };
    };
    await expect(new SandboxProcessesApi(transport.asTransport()).start("test")).rejects.toThrow(
      /Expected process start event/
    );
    expect(transport.closed).toBe(true);
  });
});
