import { afterEach, describe, expect, test } from "vitest";
import {
  resolveRuntimeTransportTarget,
  toWebSocketUrl,
} from "../../../src/sandbox/ws";

const ORIGINAL_REGIONAL_PROXY_DEV_HOST = process.env.REGIONAL_PROXY_DEV_HOST;

afterEach(() => {
  if (ORIGINAL_REGIONAL_PROXY_DEV_HOST === undefined) {
    delete process.env.REGIONAL_PROXY_DEV_HOST;
    return;
  }
  process.env.REGIONAL_PROXY_DEV_HOST = ORIGINAL_REGIONAL_PROXY_DEV_HOST;
});

describe("sandbox runtime transport target", () => {
  test("ignores ambient REGIONAL_PROXY_DEV_HOST without an explicit override", () => {
    process.env.REGIONAL_PROXY_DEV_HOST = "http://127.0.0.1:8090";

    const target = resolveRuntimeTransportTarget(
      "https://session.example.dev:8443",
      "/sandbox/exec?foo=bar"
    );

    expect(target).toEqual({
      url: "https://session.example.dev:8443/sandbox/exec?foo=bar",
    });
  });

  test("applies an explicit runtime proxy override and preserves the original host header", () => {
    const target = resolveRuntimeTransportTarget(
      "https://session.example.dev:8443",
      "/sandbox/exec?foo=bar",
      "http://127.0.0.1:8090"
    );

    expect(target).toEqual({
      url: "http://127.0.0.1:8090/sandbox/exec?foo=bar",
      hostHeader: "session.example.dev:8443",
    });
  });

  test("applies the explicit override to websocket targets", () => {
    const target = toWebSocketUrl(
      "https://session.example.dev:8443",
      "/sandbox/pty/pty_123/ws?sessionId=sandbox_123",
      "http://127.0.0.1:8090"
    );

    expect(target).toEqual({
      url: "ws://127.0.0.1:8090/sandbox/pty/pty_123/ws?sessionId=sandbox_123",
      hostHeader: "session.example.dev:8443",
    });
  });
});
