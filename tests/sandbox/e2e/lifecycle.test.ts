/**
 * Intent: verify sandbox lifecycle and runtime-session behavior, including
 * negative cases for stopped or missing sandboxes.
 */

import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SandboxHandle } from "../../../src/services/sandboxes";
import { createClient } from "../../helpers/config";
import { expectHyperbrowserError } from "../../helpers/errors";
import {
  defaultSandboxParams,
  stopSandboxIfRunning,
  waitForRuntimeReady,
} from "../../helpers/sandbox";

const client = createClient();

describe.sequential("sandbox lifecycle e2e", () => {
  let sandbox: SandboxHandle | null = null;
  let staleHandle: SandboxHandle | null = null;
  let secondary: SandboxHandle | null = null;

  beforeAll(async () => {
    sandbox = await client.sandboxes.create(defaultSandboxParams("sdk-lifecycle"));
    staleHandle = await client.sandboxes.get(sandbox.id);
    await waitForRuntimeReady(sandbox);
  });

  afterAll(async () => {
    await stopSandboxIfRunning(sandbox);
    await stopSandboxIfRunning(staleHandle);
    await stopSandboxIfRunning(secondary);
  });

  test("create response contains runtime auth", async () => {
    const detail = sandbox!.toJSON();
    expect(detail.token).toBeTruthy();
    expect(detail.runtime.baseUrl).toBeTruthy();
    expect(detail.tokenExpiresAt).toBeTruthy();
  });

  test("createRuntimeSession returns a usable runtime session", async () => {
    const session = await sandbox!.createRuntimeSession();
    expect(session.token.length).toBeGreaterThan(0);
    expect(session.sandboxId).toBe(sandbox!.id);
    expect(session.runtime.baseUrl).toBe(sandbox!.runtime.baseUrl);
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

  test("runtime requests refresh and retry on 401", async () => {
    const originalCreateRuntimeSession = sandbox!.createRuntimeSession.bind(sandbox);
    const validSession = await originalCreateRuntimeSession(true);
    const invalidJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid-signature";
    let refreshCount = 0;

    sandbox!.createRuntimeSession = (async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        refreshCount += 1;
        return originalCreateRuntimeSession(true);
      }

      return {
        ...validSession,
        token: invalidJwt,
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }) as SandboxHandle["createRuntimeSession"];

    try {
      const result = await sandbox!.exec("echo runtime-refresh-ok");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("runtime-refresh-ok");
      expect(refreshCount).toBeGreaterThan(0);
      expect(sandbox!.toJSON().token).toBeTruthy();
      expect(sandbox!.toJSON().token).not.toBe(invalidJwt);
    } finally {
      sandbox!.createRuntimeSession = originalCreateRuntimeSession;
    }
  });

  test("list includes the active sandbox", async () => {
    const list = await client.sandboxes.list({
      search: sandbox!.id,
      limit: 20,
    });

    expect(list.sandboxes.some((entry) => entry.id === sandbox!.id)).toBe(true);
  });

  test("stop closes the sandbox", async () => {
    const response = await sandbox!.stop();
    expect(response.success).toBe(true);
    expect(sandbox!.status).toBe("closed");
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
        service: "control",
        retryable: false,
        messageIncludes: "Sandbox is not running",
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

  test("startFromSnapshot creates a second sandbox that can also be stopped", async () => {
    secondary = await client.sandboxes.startFromSnapshot(
      defaultSandboxParams("sdk-secondary")
    );

    const response = await secondary.stop();
    expect(response.success).toBe(true);
    expect(secondary.status).toBe("closed");
  });
});
