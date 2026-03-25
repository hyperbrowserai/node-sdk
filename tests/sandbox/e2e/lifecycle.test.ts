/**
 * Intent: verify sandbox lifecycle and runtime-auth refresh behavior, including
 * negative cases for stopped or missing sandboxes.
 */

import { randomUUID } from "crypto";
import fetch from "node-fetch";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import {
  API_KEY,
  BASE_URL,
  createClient,
  DEFAULT_IMAGE_NAME,
} from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForCreatedSnapshot,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

const client = createClient();
const CUSTOM_IMAGE_NAME = "node";
const SNAPSHOT_CREATE_TEST_TIMEOUT_MS = 90_000;

type ListedFirecrackerImage = {
  id: string;
  imageName: string;
  namespace: string;
  uploaded: boolean;
};

async function getCustomImageByName(
  imageName: string
): Promise<ListedFirecrackerImage> {
  const response = await fetch(`${BASE_URL}/api/images`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`failed to parse /api/images response: ${text}`);
  }

  if (!response.ok) {
    throw new Error(
      `GET /api/images failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }

  const images = payload.data?.images || payload.images;
  if (!Array.isArray(images)) {
    throw new Error(`unexpected /api/images payload: ${JSON.stringify(payload)}`);
  }

  const image = images.find(
    (entry: ListedFirecrackerImage) => entry.imageName === imageName
  );

  if (!image) {
    throw new Error(
      `custom image ${JSON.stringify(imageName)} not found in /api/images`
    );
  }

  return image;
}

describe.sequential("sandbox lifecycle e2e", () => {
  let sandbox: SandboxHandle | null = null;
  let staleHandle: SandboxHandle | null = null;
  let secondary: SandboxHandle | null = null;
  let imageSandbox: SandboxHandle | null = null;
  let customImageSandbox: SandboxHandle | null = null;
  let customSnapshotSandbox: SandboxHandle | null = null;
  let memorySnapshot:
    | Awaited<ReturnType<NonNullable<SandboxHandle>["createMemorySnapshot"]>>
    | null = null;
  let customImageMemorySnapshot:
    | Awaited<ReturnType<NonNullable<SandboxHandle>["createMemorySnapshot"]>>
    | null = null;
  let customImage: ListedFirecrackerImage | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-lifecycle"));
    staleHandle = await client.sandboxes.get(sandbox.id);
    customImage = await getCustomImageByName(CUSTOM_IMAGE_NAME);
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
    await stopSandboxIfRunning(staleHandle);
    await stopSandboxIfRunning(secondary);
    await stopSandboxIfRunning(imageSandbox);
    await stopSandboxIfRunning(customImageSandbox);
    await stopSandboxIfRunning(customSnapshotSandbox);
  });

  test("create response contains runtime auth", async () => {
    const detail = sandbox!.toJSON();
    expect(detail.token).toBeTruthy();
    expect(detail.runtime.baseUrl).toBeTruthy();
    expect(detail.tokenExpiresAt).toBeTruthy();
  });

  test("get returns runtime auth for an active sandbox", async () => {
    expect(staleHandle).toBeTruthy();
    const detail = staleHandle!.toJSON();
    expect(detail.token).toBeTruthy();
    expect(detail.runtime.baseUrl).toBe(sandbox!.runtime.baseUrl);
  });

  test("info and refresh update the sandbox handle", async () => {
    const info = await sandbox!.info();
    expect(info.id).toBe(sandbox!.id);
    await sandbox!.refresh();
    expect(sandbox!.status).toBe("active");
  });

  test("connect succeeds while sandbox is active", async () => {
    await sandbox!.connect();
    expect(sandbox!.status).toBe("active");
  });

  test("createMemorySnapshot returns snapshot metadata for an active sandbox", async () => {
    memorySnapshot = await sandbox!.createMemorySnapshot();
    expect(memorySnapshot.snapshotName.length).toBeGreaterThan(0);
    expect(memorySnapshot.snapshotId.length).toBeGreaterThan(0);
    expect(memorySnapshot.namespace.length).toBeGreaterThan(0);
    expect(memorySnapshot.status.length).toBeGreaterThan(0);
    expect(memorySnapshot.imageName.length).toBeGreaterThan(0);
    expect(memorySnapshot.imageId.length).toBeGreaterThan(0);
    expect(memorySnapshot.imageNamespace.length).toBeGreaterThan(0);
  });

  test("runtime requests refresh and retry on 401", async () => {
    const sandboxInternal = sandbox as unknown as {
      detail: SandboxHandle["toJSON"] extends () => infer T ? T : never;
      runtimeSession: {
        sandboxId: string;
        status: string;
        region: string;
        token: string;
        tokenExpiresAt: string | null;
        runtime: { baseUrl: string };
      } | null;
      service: {
        getDetail: (id: string) => Promise<ReturnType<SandboxHandle["toJSON"]>>;
      };
    };
    const validDetail = await sandbox!.info();
    const invalidJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid-signature";
    let refreshCount = 0;
    const originalGetDetail = sandboxInternal.service.getDetail.bind(
      sandboxInternal.service
    );

    sandboxInternal.runtimeSession = {
      sandboxId: sandbox!.id,
      status: validDetail.status,
      region: validDetail.region,
      token: invalidJwt,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      runtime: validDetail.runtime,
    };
    sandboxInternal.detail = {
      ...validDetail,
      token: invalidJwt,
      tokenExpiresAt: sandboxInternal.runtimeSession.tokenExpiresAt,
    };

    sandboxInternal.service.getDetail = (async (id: string) => {
      refreshCount += 1;
      return originalGetDetail(id);
    }) as typeof sandboxInternal.service.getDetail;

    try {
      const result = await sandbox!.exec("echo runtime-refresh-ok");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("runtime-refresh-ok");
      expect(refreshCount).toBeGreaterThan(0);
      expect(sandbox!.toJSON().token).toBeTruthy();
      expect(sandbox!.toJSON().token).not.toBe(invalidJwt);
    } finally {
      sandboxInternal.service.getDetail = originalGetDetail;
    }
  });

  test("create from image returns a sandbox that can be stopped", async () => {
    imageSandbox = await client.sandboxes.create({
      imageName: DEFAULT_IMAGE_NAME,
    });

    expect(imageSandbox.id).toBeTruthy();
    expect(imageSandbox.status).toBe("active");

    const response = await imageSandbox.stop();
    expect(response.success).toBe(true);
    expect(imageSandbox.status).toBe("closed");
  });

  test("create from a custom image by explicit imageName and imageId succeeds", async () => {
    expect(customImage).toBeTruthy();

    customImageSandbox = await client.sandboxes.create({
      imageName: customImage!.imageName,
      imageId: customImage!.id,
    });

    expect(customImageSandbox.id).toBeTruthy();
    expect(customImageSandbox.status).toBe("active");

    await waitForRuntimeReady(customImageSandbox);
  });

  test("memory snapshot from an image-backed sandbox returns matching image metadata", async () => {
    expect(customImageSandbox).toBeTruthy();
    expect(customImage).toBeTruthy();

    customImageMemorySnapshot = await customImageSandbox!.createMemorySnapshot();

    expect(customImageMemorySnapshot.imageName).toBe(customImage!.imageName);
    expect(customImageMemorySnapshot.imageId).toBe(customImage!.id);
    expect(customImageMemorySnapshot.imageNamespace).toBe(customImage!.namespace);
  });

  test(
    "create from an image-backed memory snapshot succeeds",
    async () => {
    expect(customImageMemorySnapshot).toBeTruthy();

      await waitForCreatedSnapshot(client, customImageMemorySnapshot!.snapshotId);
      customSnapshotSandbox = await client.sandboxes.create({
        snapshotName: customImageMemorySnapshot!.snapshotName,
        snapshotId: customImageMemorySnapshot!.snapshotId,
      });

      expect(customSnapshotSandbox.id).toBeTruthy();
      expect(customSnapshotSandbox.status).toBe("active");

      const response = await customSnapshotSandbox.stop();
      expect(response.success).toBe(true);
      expect(customSnapshotSandbox.status).toBe("closed");
    },
    SNAPSHOT_CREATE_TEST_TIMEOUT_MS
  );

  test("mismatched imageName and imageId returns a structured 404", async () => {
    expect(customImage).toBeTruthy();

    await expectHyperbrowserError(
      "mismatched image selector",
      () =>
        client.sandboxes.create({
          imageName: customImage!.imageName,
          imageId: randomUUID(),
        }),
      {
        statusCode: 404,
        service: "control",
        retryable: false,
        messageIncludesAny: ["image not found", "not found"],
      }
    );
  });

  test("mismatched snapshotName and snapshotId returns a structured 404", async () => {
    expect(memorySnapshot).toBeTruthy();

    await expectHyperbrowserError(
      "mismatched snapshot selector",
      () =>
        client.sandboxes.create({
          snapshotName: memorySnapshot!.snapshotName,
          snapshotId: randomUUID(),
        }),
      {
        statusCode: 404,
        service: "control",
        retryable: false,
        messageIncludesAny: ["snapshot not found", "not found"],
      }
    );
  });

  test("stop closes the sandbox", async () => {
    const response = await sandbox!.stop();
    expect(response.success).toBe(true);
    expect(sandbox!.status).toBe("closed");
  });

  test("memory snapshot on a stopped sandbox fails cleanly", async () => {
    await expectHyperbrowserError(
      "stopped sandbox memory snapshot",
      () => sandbox!.createMemorySnapshot(),
      {
        statusCode: 409,
        service: "control",
        retryable: false,
        messageIncludes: "Sandbox is not running",
      }
    );
  });

  test("connect on a stopped handle fails locally with a structured error", async () => {
    await expectHyperbrowserError("stopped sandbox connect", () => sandbox!.connect(), {
      statusCode: 409,
      code: "sandbox_not_running",
      service: "runtime",
      retryable: false,
      messageIncludes: "not running",
    });
  });

  test("runtime calls on a stopped handle fail locally with a structured error", async () => {
    await expectHyperbrowserError(
      "stopped sandbox exec",
      () => sandbox!.exec("echo should-not-run"),
      {
        statusCode: 409,
        code: "sandbox_not_running",
        service: "runtime",
        retryable: false,
        messageIncludes: "not running",
      }
    );
  });

  test("stale active-looking handle fails cleanly when connect refreshes against server", async () => {
    await expectHyperbrowserError(
      "stale sandbox connect",
      () => staleHandle!.connect(),
      {
        statusCode: 409,
        code: "sandbox_not_running",
        service: "runtime",
        retryable: false,
        messageIncludes: "not running",
      }
    );
  });

  test("client.sandboxes.connect on a stopped sandbox also fails", async () => {
    await expectHyperbrowserError(
      "stopped sandbox reconnect",
      () => client.sandboxes.connect(sandbox!.id),
      {
        statusCode: 409,
        code: "sandbox_not_running",
        service: "runtime",
        retryable: false,
        messageIncludes: "not running",
      }
    );
  });

  test("missing sandbox lookup returns a structured 404", async () => {
    await expectHyperbrowserError(
      "missing sandbox get",
      () => client.sandboxes.get(randomUUID()),
      {
        statusCode: 404,
        service: "control",
        retryable: false,
        messageIncludes: "not found",
      }
    );
  });

  test(
    "create with a snapshot selector creates a second sandbox that can also be stopped",
    async () => {
      expect(memorySnapshot).toBeTruthy();

      await waitForCreatedSnapshot(client, memorySnapshot!.snapshotId);
      secondary = await client.sandboxes.create({
        snapshotName: memorySnapshot!.snapshotName,
        snapshotId: memorySnapshot!.snapshotId,
      });

      const response = await secondary.stop();
      expect(response.success).toBe(true);
      expect(secondary.status).toBe("closed");
    },
    SNAPSHOT_CREATE_TEST_TIMEOUT_MS
  );
});
