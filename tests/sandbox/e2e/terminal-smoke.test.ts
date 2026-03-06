/**
 * Intent: verify non-interactive PTY behavior, including attach/write/resize,
 * alias access through `pty`, and structured errors for missing or timed-out PTYs.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import type { SandboxTerminalConnection } from "../../../src/runtime/terminal";
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

    await timeoutTerminal.kill();
    const status = await timeoutTerminal.wait({ timeoutMs: 3_000 });
    expect(status.running).toBe(false);
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
