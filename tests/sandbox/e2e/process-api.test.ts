import { describe, expect, test, vi } from "vitest";
import type { RuntimeTransport } from "../../../src/sandbox/base";
import { SandboxProcessesApi } from "../../../src/sandbox/process";
import { SandboxHandle } from "../../../src/services/sandboxes";

const execResponse = {
  result: {
    id: "proc_exec",
    status: "exited" as const,
    exit_code: 0,
    stdout: "ok\n",
    stderr: "",
    started_at: 1,
    completed_at: 2,
  },
};

const startResponse = {
  process: {
    id: "proc_start",
    status: "running" as const,
    command: "sleep 30",
    cwd: "/tmp",
    started_at: 1,
  },
};

describe("sandbox process api", () => {
  test("exec string overload forwards runAs in the runtime payload", async () => {
    const requestJSON = vi
      .fn()
      .mockResolvedValueOnce(execResponse)
      .mockResolvedValueOnce(startResponse);
    const transport = {
      requestJSON,
    } as unknown as RuntimeTransport;
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

    expect(requestJSON).toHaveBeenNthCalledWith(
      1,
      "/sandbox/exec",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command: "whoami",
          cwd: "/tmp",
          env: { FOO: "bar" },
          timeoutMs: 5_000,
          runAs: "root",
        }),
      })
    );
    expect(requestJSON).toHaveBeenNthCalledWith(
      2,
      "/sandbox/processes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command: "sleep 30",
          cwd: "/tmp",
          runAs: "root",
        }),
      })
    );
  });

  test("exec object form preserves runAs in the runtime payload", async () => {
    const requestJSON = vi.fn().mockResolvedValue(execResponse);
    const transport = {
      requestJSON,
    } as unknown as RuntimeTransport;
    const api = new SandboxProcessesApi(transport);

    await api.exec({
      command: "whoami",
      runAs: "root",
      timeoutSec: 5,
    });

    expect(requestJSON).toHaveBeenCalledWith(
      "/sandbox/exec",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command: "whoami",
          timeout_sec: 5,
          runAs: "root",
        }),
      })
    );
  });

  test("legacy args and useShell are normalized out of process payloads", async () => {
    const requestJSON = vi
      .fn()
      .mockResolvedValueOnce(execResponse)
      .mockResolvedValueOnce(startResponse);
    const transport = {
      requestJSON,
    } as unknown as RuntimeTransport;
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

    const execPayload = JSON.parse(requestJSON.mock.calls[0][1].body);
    expect(execPayload).toEqual({
      command: "/bin/echo 'legacy args value'",
      runAs: "root",
    });
    expect(execPayload).not.toHaveProperty("args");
    expect(execPayload).not.toHaveProperty("useShell");

    const startPayload = JSON.parse(requestJSON.mock.calls[1][1].body);
    expect(startPayload).toEqual({
      command: "bash -lc 'echo process-started'",
      cwd: "/tmp",
    });
    expect(startPayload).not.toHaveProperty("args");
    expect(startPayload).not.toHaveProperty("useShell");
  });

  test("sandbox handle exec forwards string options to processes.exec", async () => {
    const exec = vi.fn().mockResolvedValue(execResponse.result);

    await SandboxHandle.prototype.exec.call(
      {
        processes: { exec },
      },
      "whoami",
      { runAs: "root" }
    );

    expect(exec).toHaveBeenCalledWith("whoami", { runAs: "root" });
  });
});
