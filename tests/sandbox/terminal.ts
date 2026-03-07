import "../load-env";
import { Hyperbrowser, HyperbrowserError } from "../../src";
import type { SandboxTerminalConnection } from "../../src/runtime/terminal";
import type { CreateSandboxParams } from "../../src/types";

const API_KEY = process.env.HYPERBROWSER_API_KEY || "";
const BASE_URL = process.env.HYPERBROWSER_BASE_URL || "http://localhost:8080";

const SANDBOX = {
  sandboxName: `sdk-terminal-${Date.now()}`,
  snapshotName: "receiverStarted-ubuntu-24-node",
} satisfies CreateSandboxParams;

const TERMINAL = {
  command: "bash",
  args: ["-l"],
};

async function main() {
  if (!API_KEY) {
    throw new Error(
      "Set HYPERBROWSER_API_KEY in tests/.env before running this script"
    );
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("This script must be run from an interactive TTY");
  }

  const client = new Hyperbrowser({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  let sandbox: Awaited<ReturnType<typeof client.sandboxes.create>> | null = null;
  let terminal: Awaited<
    ReturnType<Awaited<ReturnType<typeof client.sandboxes.create>>["terminal"]["create"]>
  > | null = null;
  let connection: SandboxTerminalConnection | null = null;

  const stdin = process.stdin;
  const stdout = process.stdout;

  let restoreTerminalDone = false;
  let inputChain = Promise.resolve();

  const restoreTerminal = () => {
    if (restoreTerminalDone) {
      return;
    }
    restoreTerminalDone = true;
    stdin.removeListener("data", onInput);
    process.removeListener("SIGWINCH", onResize);
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    stdin.pause();
  };

  const onResize = () => {
    if (!terminal || !stdout.isTTY) {
      return;
    }
    void terminal.resize(stdout.rows || 24, stdout.columns || 80).catch((error) => {
      process.stderr.write(`\nterminal resize failed: ${String(error)}\n`);
    });
  };

  const onInput = (chunk: Buffer) => {
    if (!connection) {
      return;
    }
    inputChain = inputChain
      .then(() => connection!.write(chunk))
      .catch((error) => {
        process.stderr.write(`\nterminal input failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
  };

  try {
    sandbox = await client.sandboxes.create(SANDBOX);

    process.stderr.write(`sandbox created: ${sandbox.id}\n`);
    process.stderr.write(`session url: ${sandbox.sessionUrl}\n`);
    process.stderr.write("starting interactive terminal...\n");

    terminal = await sandbox.terminal.create({
      ...TERMINAL,
      rows: stdout.rows || 24,
      cols: stdout.columns || 80,
    });

    connection = await terminal.attach();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onInput);
    process.on("SIGWINCH", onResize);

    process.stderr.write("connected. type `exit` to close the remote shell.\n\n");

    for await (const event of connection.events()) {
      if (event.type === "output") {
        stdout.write(event.data);
        continue;
      }

      process.exitCode = event.status.exitCode ?? 0;
      process.stderr.write(
        `\nremote terminal exited with code ${event.status.exitCode ?? 0}\n`
      );
      break;
    }
  } catch (error) {
    restoreTerminal();
    if (error instanceof HyperbrowserError) {
      process.stderr.write("sdk error\n");
      process.stderr.write(
        `${JSON.stringify(
          {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code,
            requestId: error.requestId,
            retryable: error.retryable,
            service: error.service,
            details: error.details,
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exitCode = 1;
  } finally {
    restoreTerminal();

    if (connection) {
      try {
        await connection.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }

    if (sandbox) {
      try {
        await sandbox.stop();
        process.stderr.write(`sandbox stopped: ${sandbox.id}\n`);
      } catch (error) {
        process.stderr.write(`failed to stop sandbox: ${String(error)}\n`);
        process.exitCode = 1;
      }
    }
  }
}

void main();
