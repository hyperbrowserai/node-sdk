/**
 * Intent: verify process execution, streaming, stdin/signal/kill controls,
 * and structured error handling for missing or timed-out processes.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import type { SandboxProcessStreamEvent } from "../../../src/types";
import { createClient } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

async function collectProcessStream(
  events: AsyncIterable<SandboxProcessStreamEvent>
): Promise<SandboxProcessStreamEvent[]> {
  const out: SandboxProcessStreamEvent[] = [];
  for await (const event of events) {
    out.push(event);
    if (event.type === "exit") {
      break;
    }
  }
  return out;
}

const client = createClient();

describe.sequential("sandbox process e2e", () => {
  let sandbox: SandboxHandle | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-process"));
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("exec handles a successful one-shot command", async () => {
    const result = await sandbox!.exec("echo process-exec-ok");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("process-exec-ok");
  });

  test("exec returns non-zero results without throwing", async () => {
    const result = await sandbox!.exec({
      command: "bash",
      args: ["-lc", "echo process-exec-fail 1>&2; exit 7"],
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("process-exec-fail");
  });

  test("get and list expose the running process", async () => {
    const stdinProcess = await sandbox!.processes.start({
      command: "bash",
      args: ["-lc", "read line; echo stdout:$line; echo stderr:$line 1>&2"],
    });

    const fetched = await sandbox!.getProcess(stdinProcess.id);
    expect(fetched.id).toBe(stdinProcess.id);

    const list = await sandbox!.processes.list({ limit: 20 });
    expect(list.data.some((entry) => entry.id === stdinProcess.id)).toBe(true);

    await stdinProcess.writeStdin({ data: "sdk-stdin\n", eof: true });
    const result = await stdinProcess.wait();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stdout:sdk-stdin");
    expect(result.stderr).toContain("stderr:sdk-stdin");
  });

  test("stream normalizes stdout, stderr, and exit events", async () => {
    const streamed = await sandbox!.processes.start({
      command: "bash",
      args: ["-lc", "echo stream-out; echo stream-err 1>&2"],
    });

    const events = await collectProcessStream(streamed.stream());

    expect(
      events.some((event) => event.type === "stdout" && event.data.includes("stream-out"))
    ).toBe(true);
    expect(
      events.some((event) => event.type === "stderr" && event.data.includes("stream-err"))
    ).toBe(true);
    expect(events.some((event) => event.type === "exit")).toBe(true);
  });

  test("wait timeout returns a structured error", async () => {
    const timeoutProcess = await sandbox!.processes.start({
      command: "bash",
      args: ["-lc", "sleep 10"],
    });

    await expectHyperbrowserError(
      "process wait timeout",
      () => timeoutProcess.wait({ timeoutMs: 100 }),
      {
        statusCode: 408,
        service: "runtime",
        retryable: false,
        messageIncludes: "timed out",
      }
    );

    await timeoutProcess.signal("TERM");
    const result = await timeoutProcess.wait({ timeoutMs: 3_000 });
    expect(["exited", "failed", "killed", "timed_out"]).toContain(result.status);
  });

  test("kill terminates a running process", async () => {
    const killProcess = await sandbox!.processes.start({
      command: "bash",
      args: ["-lc", "sleep 30"],
    });

    const result = await killProcess.kill();
    expect(["running", "queued"]).not.toContain(result.status);
    expect(["running", "queued"]).not.toContain(killProcess.status);
  });

  test("missing process lookups return structured errors", async () => {
    await expectHyperbrowserError(
      "missing process get",
      () => sandbox!.getProcess("proc_missing"),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludes: "not found",
      }
    );
  });
});
