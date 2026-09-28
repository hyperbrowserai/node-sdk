import { describe, expect, test, vi } from "vitest";
import type { RuntimeSSEEvent, RuntimeSSEInit, RuntimeTransport } from "../../../src/sandbox/base";
import { SandboxProcessesApi } from "../../../src/sandbox/process";
import { SandboxHandle } from "../../../src/services/sandboxes";

const execResponse = {
  result: {
    id: "proc_exec",
    status: "exited" as const,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    startedAt: 1,
    completedAt: 2,
  },
};

const startedEvent: RuntimeSSEEvent = {
  event: "started",
  data: { id: "proc_start", status: "running", command: "sleep 30", cwd: "/tmp", started_at: 1 },
};

const doneEvent: RuntimeSSEEvent = {
  event: "done",
  data: {
    id: "proc_start",
    status: "exited",
    exit_code: 0,
    started_at: 1,
    completed_at: 2,
    last_seq: 0,
  },
};

/** Every start opens one streamed POST whose body is the runtime payload. */
const streamingTransport = () => {
  const openSSE = vi.fn(async (_path: string, _params: unknown, _init?: RuntimeSSEInit) => ({
    events: (async function* () {
      yield startedEvent;
      yield doneEvent;
    })(),
    close: () => undefined,
  }));
  return { openSSE, transport: { openSSE } as unknown as RuntimeTransport };
};

const payloadOf = (openSSE: ReturnType<typeof vi.fn>, index: number) =>
  JSON.parse((openSSE.mock.calls[index][2] as RuntimeSSEInit).body ?? "");

describe("sandbox process api", () => {
  test("exec string overload forwards runAs in the runtime payload", async () => {
    const { openSSE, transport } = streamingTransport();
    const api = new SandboxProcessesApi(transport);

    await api.exec("whoami", {
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 5_000,
      runAs: "root",
    });
    await api.start("sleep 30", {
      cwd: "/tmp",
      runAs: "root",
    });

    expect(openSSE).toHaveBeenCalledTimes(2);
    expect(openSSE.mock.calls[0][0]).toBe("/sandbox/processes");
    expect(openSSE.mock.calls[0][2]).toMatchObject({ method: "POST" });
    expect(payloadOf(openSSE, 0)).toEqual({
      command: "whoami",
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 5_000,
      runAs: "root",
    });
    expect(payloadOf(openSSE, 1)).toEqual({
      command: "sleep 30",
      cwd: "/tmp",
      runAs: "root",
    });
  });

  test("exec object form preserves runAs in the runtime payload", async () => {
    const { openSSE, transport } = streamingTransport();
    const api = new SandboxProcessesApi(transport);

    await api.exec({
      command: "whoami",
      runAs: "root",
      timeoutSec: 5,
    });

    expect(payloadOf(openSSE, 0)).toEqual({
      command: "whoami",
      timeout_sec: 5,
      runAs: "root",
    });
  });

  test("legacy args and useShell are normalized out of process payloads", async () => {
    const { openSSE, transport } = streamingTransport();
    const api = new SandboxProcessesApi(transport);

    await api.exec({
      command: "/bin/echo",
      args: ["legacy args value"],
      useShell: false,
      runAs: "root",
    });
    await api.start({
      command: "bash",
      args: ["-lc", "echo process-started"],
      useShell: true,
      cwd: "/tmp",
    });

    const execPayload = payloadOf(openSSE, 0);
    expect(execPayload).toEqual({
      command: "/bin/echo 'legacy args value'",
      runAs: "root",
    });
    expect(execPayload).not.toHaveProperty("args");
    expect(execPayload).not.toHaveProperty("useShell");

    const startPayload = payloadOf(openSSE, 1);
    expect(startPayload).toEqual({
      command: "bash -lc 'echo process-started'",
      cwd: "/tmp",
    });
    expect(startPayload).not.toHaveProperty("args");
    expect(startPayload).not.toHaveProperty("useShell");
  });

  test("sandbox handle exec forwards string options to processes.exec", async () => {
    const exec = vi.fn().mockResolvedValue(execResponse.result);

    const execString = SandboxHandle.prototype.exec as (
      input: string,
      options?: { runAs?: string }
    ) => Promise<unknown>;
    await execString.call(
      {
        processes: { exec },
      },
      "whoami",
      { runAs: "root" }
    );

    expect(exec).toHaveBeenCalledWith("whoami", { runAs: "root" });
  });
});
