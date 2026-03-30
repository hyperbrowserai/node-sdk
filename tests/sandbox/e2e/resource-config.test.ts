import { describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient, DEFAULT_IMAGE_NAME } from "../../helpers/config";
import { stopSandboxIfRunning, waitForRuntimeReady } from "../../helpers/sandbox";

const client = createClient();

const REQUESTED_CPU = 8;
const REQUESTED_MEMORY_MIB = 8192;
const REQUESTED_DISK_MIB = 10240;
const MEMORY_MIN_VISIBLE_MIB = REQUESTED_MEMORY_MIB - 512;
const DISK_MIN_VISIBLE_MIB = REQUESTED_DISK_MIB - 512;

async function execInteger(sandbox: SandboxHandle, command: string): Promise<number> {
  const result = await sandbox.exec(command);
  expect(result.exitCode).toBe(0);

  const value = Number.parseInt(result.stdout.trim(), 10);
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

describe.sequential("sandbox resource config e2e", () => {
  test("image launch applies cpu memory and disk sizing", async () => {
    let sandbox: SandboxHandle | null = null;

    try {
      sandbox = await client.sandboxes.create({
        imageName: DEFAULT_IMAGE_NAME,
        cpu: REQUESTED_CPU,
        memory: REQUESTED_MEMORY_MIB,
        disk: REQUESTED_DISK_MIB,
      });

      expect(sandbox.cpu).toBe(REQUESTED_CPU);
      expect(sandbox.memory).toBe(REQUESTED_MEMORY_MIB);
      expect(sandbox.disk).toBe(REQUESTED_DISK_MIB);

      const detail = await sandbox.info();
      expect(detail.cpu).toBe(REQUESTED_CPU);
      expect(detail.memory).toBe(REQUESTED_MEMORY_MIB);
      expect(detail.disk).toBe(REQUESTED_DISK_MIB);

      const reloaded = await client.sandboxes.get(sandbox.id);
      expect(reloaded.cpu).toBe(REQUESTED_CPU);
      expect(reloaded.memory).toBe(REQUESTED_MEMORY_MIB);
      expect(reloaded.disk).toBe(REQUESTED_DISK_MIB);

      await waitForRuntimeReady(sandbox);

      const cpuCount = await execInteger(sandbox, "nproc");
      const memoryMiB = await execInteger(
        sandbox,
        "awk '/MemTotal/ {printf \"%.0f\\n\", $2/1024}' /proc/meminfo"
      );
      const diskMiB = await execInteger(sandbox, "df -m / | awk 'NR==2 {print $2}'");

      expect(cpuCount).toBe(REQUESTED_CPU);
      expect(memoryMiB).toBeGreaterThanOrEqual(MEMORY_MIN_VISIBLE_MIB);
      expect(memoryMiB).toBeLessThanOrEqual(REQUESTED_MEMORY_MIB);
      expect(diskMiB).toBeGreaterThanOrEqual(DISK_MIN_VISIBLE_MIB);
      expect(diskMiB).toBeLessThanOrEqual(REQUESTED_DISK_MIB);
    } finally {
      await stopSandboxIfRunning(sandbox);
    }
  });
});
