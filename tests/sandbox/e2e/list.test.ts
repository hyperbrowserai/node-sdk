/**
 * Intent: verify live control-plane list APIs for sandboxes, images, and snapshots.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import type { Sandbox, SandboxSnapshotSummary } from "../../../src/types";
import { createClient, testName } from "../../helpers/config";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

const client = createClient();
const SANDBOX_PAGE_LIMIT = 50;
const SNAPSHOT_LIST_LIMIT = 200;
const LIST_POLL_DELAY_MS = 500;
const LIST_POLL_TIMEOUT_MS = 90_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForSandboxInList(sandboxId: string): Promise<Sandbox> {
  const deadline = Date.now() + LIST_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let page = 1;

    while (true) {
      const response = await client.sandboxes.list({
        status: "active",
        page,
        limit: SANDBOX_PAGE_LIMIT,
      });

      const match = response.sandboxes.find((entry) => entry.id === sandboxId);
      if (match) {
        return match;
      }

      const hasMore = page * response.perPage < response.totalCount;
      if (!hasMore || response.sandboxes.length === 0) {
        break;
      }

      page += 1;
    }

    await sleep(LIST_POLL_DELAY_MS);
  }

  throw new Error(`sandbox ${sandboxId} did not appear in list()`);
}

async function waitForCreatedSnapshot(snapshotId: string): Promise<SandboxSnapshotSummary> {
  const deadline = Date.now() + LIST_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await client.sandboxes.listSnapshots({
      limit: SNAPSHOT_LIST_LIMIT,
    });
    const match = response.snapshots.find((entry) => entry.id === snapshotId);

    if (match?.status === "created") {
      return match;
    }

    await sleep(LIST_POLL_DELAY_MS);
  }

  throw new Error(`snapshot ${snapshotId} did not appear as created in listSnapshots()`);
}

describe.sequential("sandbox list e2e", () => {
  let sandbox: SandboxHandle | null = null;
  let memorySnapshot:
    | Awaited<ReturnType<NonNullable<SandboxHandle>["createMemorySnapshot"]>>
    | null = null;
  const snapshotName = testName("sdk-list-snapshot");

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-list"));
    await waitForRuntimeReady(sandbox);
    memorySnapshot = await sandbox.createMemorySnapshot({
      snapshotName,
    });
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
  });

  test("list returns the created sandbox in the active set", async () => {
    expect(sandbox).toBeTruthy();

    const listed = await waitForSandboxInList(sandbox!.id);

    expect(listed.id).toBe(sandbox!.id);
    expect(listed.status).toBe("active");
    expect(listed.region).toBe(sandbox!.region);
    expect(listed.runtime.transport).toBe("regional_proxy");
    expect(listed.runtime.baseUrl).toBe(sandbox!.runtime.baseUrl);
  });

  test("listImages returns the backing image metadata", async () => {
    expect(memorySnapshot).toBeTruthy();

    const response = await client.sandboxes.listImages();
    const listedImage = response.images.find((entry) => entry.id === memorySnapshot!.imageId);

    expect(listedImage).toBeTruthy();
    expect(listedImage!.imageName).toBe(memorySnapshot!.imageName);
    expect(listedImage!.namespace).toBe(memorySnapshot!.imageNamespace);
    expect(listedImage!.uploaded).toBeTypeOf("boolean");
  });

  test("listSnapshots returns the created memory snapshot and supports status filtering", async () => {
    expect(memorySnapshot).toBeTruthy();

    const listedSnapshot = await waitForCreatedSnapshot(memorySnapshot!.snapshotId);

    expect(listedSnapshot.id).toBe(memorySnapshot!.snapshotId);
    expect(listedSnapshot.snapshotName).toBe(snapshotName);
    expect(listedSnapshot.namespace).toBe(memorySnapshot!.namespace);
    expect(listedSnapshot.imageId).toBe(memorySnapshot!.imageId);
    expect(listedSnapshot.imageName).toBe(memorySnapshot!.imageName);
    expect(listedSnapshot.imageNamespace).toBe(memorySnapshot!.imageNamespace);
    expect(listedSnapshot.status).toBe("created");

    const createdSnapshots = await client.sandboxes.listSnapshots({
      status: "created",
      limit: SNAPSHOT_LIST_LIMIT,
    });

    expect(createdSnapshots.snapshots.some((entry) => entry.id === listedSnapshot.id)).toBe(
      true
    );
  });
});
