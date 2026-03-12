/**
 * Intent: verify non-interactive PTY behavior, including attach/write/resize,
 * alias access through `pty`, and structured errors for missing or timed-out PTYs.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import type { SandboxTerminalConnection } from "../../../src/sandbox/terminal";
import type { SandboxTerminalStatus } from "../../../src/types/sandbox";
import { createClient } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

async function collectTerminalSession(
  connection: SandboxTerminalConnection
): Promise<{ output: string; exitCode: number | null }> {
  let output = "";
  let exitCode: number | null = null;

  for await (const event of connection.events()) {
    if (event.type === "output") {
      output += event.data;
      continue;
    }

    exitCode = event.status.exitCode ?? null;
    break;
  }

  return { output, exitCode };
}

function terminalStatusOutput(status: SandboxTerminalStatus | undefined): string {
  return status?.output?.map((chunk) => chunk.data).join("") ?? "";
}

function terminalStatusRawOutput(
  status: SandboxTerminalStatus | undefined
): string {
  if (!status?.output || status.output.length === 0) {
    return "";
  }
  return Buffer.concat(status.output.map((chunk) => chunk.raw)).toString("utf8");
}

async function waitForTerminalStatusOutput(
  readStatus: () => Promise<SandboxTerminalStatus>,
  marker: string,
  timeoutMs: number = 5_000
): Promise<SandboxTerminalStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: SandboxTerminalStatus | undefined;

  while (Date.now() < deadline) {
    lastStatus = await readStatus();
    if (terminalStatusOutput(lastStatus).includes(marker)) {
      return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for terminal output ${JSON.stringify(marker)}. Last output: ${JSON.stringify(
      terminalStatusOutput(lastStatus)
    )}`
  );
}

const client = createClient();

describe.sequential("sandbox terminal e2e", () => {
  let sandbox: SandboxHandle | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(
      defaultSandboxParams("sdk-terminal-smoke")
    );
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("pty alias points to the terminal API", async () => {
    expect(sandbox!.pty).toBe(sandbox!.terminal);
  });

  test("create, attach, resize, and wait work for a PTY-backed bash session", async () => {
    const terminal = await sandbox!.terminal.create({
      command: "bash",
      args: ["-l"],
      rows: 24,
      cols: 80,
    });

    const fetched = await sandbox!.terminal.get(terminal.id);
    expect(fetched.id).toBe(terminal.id);

    const connection = await terminal.attach();
    try {
      await terminal.resize(30, 100);
      await connection.write("pwd\n");
      await connection.write("echo terminal-smoke-ok\n");
      await connection.write("exit\n");

      const result = await collectTerminalSession(connection);
      expect(result.output).toContain("terminal-smoke-ok");
      expect(result.exitCode).toBe(0);
    } finally {
      await connection.close();
    }

    const result = await terminal.wait({ timeoutMs: 2_000 });
    expect(result.running).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("terminal refresh reflects connection-side resize updates", async () => {
    const terminal = await sandbox!.terminal.create({
      command: "bash",
      args: ["-l"],
      rows: 24,
      cols: 80,
    });

    const connection = await terminal.attach();
    try {
      await connection.resize(32, 110);
      const refreshed = await terminal.refresh();
      expect(refreshed.current.rows).toBe(32);
      expect(refreshed.current.cols).toBe(110);

      await connection.write("exit\n");
      const result = await collectTerminalSession(connection);
      expect(result.exitCode).toBe(0);
    } finally {
      await connection.close();
    }

    const status = await terminal.wait({ timeoutMs: 2_000 });
    expect(status.running).toBe(false);
  });

  test("terminal.get(id, true) includes buffered output", async () => {
    const marker = "terminal-get-output";
    const terminal = await sandbox!.terminal.create({
      command: "bash",
      args: ["-lc", `printf '${marker}' && sleep 1`],
      rows: 24,
      cols: 80,
    });

    const withoutOutput = await sandbox!.terminal.get(terminal.id);
    expect(withoutOutput.current.output).toBeUndefined();

    const fetched = await waitForTerminalStatusOutput(
      async () => (await sandbox!.terminal.get(terminal.id, true)).current,
      marker
    );

    expect(terminalStatusOutput(fetched)).toContain(marker);
    expect(terminalStatusRawOutput(fetched)).toContain(marker);
    expect(fetched.output?.length).toBeGreaterThan(0);

    const status = await terminal.wait({ timeoutMs: 2_000 });
    expect(status.running).toBe(false);
    expect(status.exitCode).toBe(0);
  });

  test("terminal.refresh(true) includes buffered output", async () => {
    const marker = "terminal-refresh-output";
    const terminal = await sandbox!.terminal.create({
      command: "bash",
      args: ["-lc", `printf '${marker}' && sleep 1`],
      rows: 24,
      cols: 80,
    });

    const withoutOutput = await terminal.refresh();
    expect(withoutOutput.current.output).toBeUndefined();

    const refreshed = await waitForTerminalStatusOutput(
      async () => (await terminal.refresh(true)).current,
      marker
    );

    expect(terminalStatusOutput(refreshed)).toContain(marker);
    expect(terminalStatusRawOutput(refreshed)).toContain(marker);
    expect(refreshed.output?.length).toBeGreaterThan(0);

    const status = await terminal.wait({ timeoutMs: 2_000 });
    expect(status.running).toBe(false);
    expect(status.exitCode).toBe(0);
  });

  test("terminal.wait({ includeOutput: true }) returns buffered output", async () => {
    const marker = "terminal-wait-output";
    const terminal = await sandbox!.terminal.create({
      command: "bash",
      args: ["-lc", `printf '${marker}'`],
      rows: 24,
      cols: 80,
    });

    const status = await terminal.wait({
      timeoutMs: 2_000,
      includeOutput: true,
    });

    expect(status.running).toBe(false);
    expect(status.exitCode).toBe(0);
    expect(terminalStatusOutput(status)).toContain(marker);
    expect(terminalStatusRawOutput(status)).toContain(marker);
    expect(status.output?.length).toBeGreaterThan(0);
  });

  test("PTY wait timeout returns a structured error", async () => {
    const timeoutTerminal = await sandbox!.pty.create({
      command: "bash",
      args: ["-lc", "sleep 10"],
      rows: 24,
      cols: 80,
    });

    await expectHyperbrowserError(
      "terminal wait timeout",
      () => timeoutTerminal.wait({ timeoutMs: 100 }),
      {
        statusCode: 408,
        service: "runtime",
        retryable: false,
        messageIncludes: "timed out",
      }
    );

    await timeoutTerminal.signal("TERM");
    const status = await timeoutTerminal.wait({ timeoutMs: 3_000 });
    expect(status.running).toBe(false);
  });

  test("kill waits for the PTY to fully exit", async () => {
    const killTerminal = await sandbox!.pty.create({
      command: "bash",
      args: ["-lc", "sleep 30"],
      rows: 24,
      cols: 80,
    });

    const status = await killTerminal.kill();
    expect(status.running).toBe(false);
    expect(killTerminal.current.running).toBe(false);
  });

  test("missing PTY lookups return structured errors", async () => {
    await expectHyperbrowserError(
      "missing terminal get",
      () => sandbox!.terminal.get("pty_missing"),
      {
        statusCode: 404,
        service: "runtime",
        retryable: false,
        messageIncludes: "not found",
      }
    );
  });
});
