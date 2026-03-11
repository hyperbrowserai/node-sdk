/**
 * Intent: verify default sandbox images keep `ubuntu` as the runtime user
 * while allowing root-on-demand through passwordless sudo.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient } from "../../helpers/config";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

const client = createClient();

describe.sequential("sandbox sudo e2e", () => {
  let sandbox: SandboxHandle | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-sudo"));
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("runtime stays ubuntu and sudo grants root for privileged operations", async () => {
    const path = "/tmp/sdk-sudo-check.txt";

    const runtimeUser = await sandbox!.exec({
      command: "bash",
      args: ["-lc", "whoami && id -u && id -g"],
    });
    expect(runtimeUser.exitCode).toBe(0);
    expect(runtimeUser.stdout).toContain("ubuntu");
    expect(runtimeUser.stdout).toContain("1000");

    const directChown = await sandbox!.exec({
      command: "bash",
      args: [
        "-lc",
        [
          `printf 'sudo-check' > "${path}"`,
          `chown root:root "${path}"`,
        ].join(" && "),
      ],
    });
    expect(directChown.exitCode).not.toBe(0);
    expect(directChown.stderr.toLowerCase()).toContain("operation not permitted");

    const sudoResult = await sandbox!.exec({
      command: "bash",
      args: [
        "-lc",
        [
          `sudo -n whoami`,
          `sudo -n chown root:root "${path}"`,
          `stat -c '%U:%G' "${path}"`,
        ].join(" && "),
      ],
    });
    expect(sudoResult.exitCode).toBe(0);
    expect(sudoResult.stdout).toContain("root");
    expect(sudoResult.stdout).toContain("root:root");
  });
});
