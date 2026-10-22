import { expect, test } from "vitest";
import { HyperbrowserClient as Hyperbrowser } from "../../src/client";
import { ComputerAction, SandboxGpuType } from "../../src/types";
import type { SandboxHandle } from "../../src/services/sandboxes";

// Opt-in: creates a billable GPU sandbox from an already published CUDA image.
const enabled = Boolean(
  process.env.HYPERBROWSER_API_KEY && process.env.HYPERBROWSER_GPU_IMAGE_NAME
);
test.skipIf(!enabled)(
  "GPU provisioning, device visibility, files and connectivity",
  async () => {
    const client = new Hyperbrowser({
      apiKey: process.env.HYPERBROWSER_API_KEY!,
      ...(process.env.HYPERBROWSER_BASE_URL ? { baseUrl: process.env.HYPERBROWSER_BASE_URL } : {}),
    });
    let sandbox: SandboxHandle | undefined;
    const gpuCount = Number(process.env.HYPERBROWSER_GPU_COUNT ?? 1);
    try {
      sandbox = await client.sandboxes.create({
        imageName: process.env.HYPERBROWSER_GPU_IMAGE_NAME!,
        gpu: (process.env.HYPERBROWSER_GPU_TYPE ?? "L4") as SandboxGpuType,
        gpuCount,
        preempt: process.env.HYPERBROWSER_GPU_PREEMPT?.toLowerCase() !== "false",
        region: "us",
        diskMiB: 65536,
        timeoutMinutes: 30,
      });
      await sandbox.waitUntilReady({ timeout: 20 * 60 });
      const devices = await sandbox.exec("nvidia-smi --query-gpu=uuid --format=csv,noheader");
      expect(devices.exitCode).toBe(0);
      expect(devices.stdout.trim().split("\n")).toHaveLength(gpuCount);
      await sandbox.files.writeText("/tmp/hb-gpu-sdk.txt", "gpu-sdk-ok");
      expect(await sandbox.files.readText("/tmp/hb-gpu-sdk.txt")).toBe("gpu-sdk-ok");
      const port = await sandbox.expose({ port: 8000, auth: true });
      expect(port.auth).toBe(true);
      expect(port.url).toBeTruthy();
      await sandbox.unexpose(8000);
      await sandbox.updateNetwork({ allowOut: ["example.com"], denyOut: [] });
      await sandbox.clearNetwork();
      if (process.env.HYPERBROWSER_GPU_DESKTOP === "1") {
        expect(await sandbox.computerAction({ action: ComputerAction.SCREENSHOT })).toMatchObject({
          success: true,
          screenshot: expect.any(String),
        });
      }
    } finally {
      if (sandbox) await sandbox.stop();
    }
  },
  25 * 60 * 1000
);
