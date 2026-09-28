import { afterEach, describe, expect, test, vi } from "vitest";
import { Headers, Response } from "node-fetch";

const fetchMock = vi.fn();
vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return { ...actual, default: (...args: unknown[]) => fetchMock(...args) };
});
vi.mock("../../src/retry", async () => {
  const actual = await vi.importActual<typeof import("../../src/retry")>("../../src/retry");
  return { ...actual, retryDelay: vi.fn().mockResolvedValue(undefined) };
});

import { HyperbrowserError } from "../../src/client";
import { retryDelay } from "../../src/retry";
import { BaseService } from "../../src/services/base";

class TestService extends BaseService {
  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string) {
    return this.request<T>(path, { method: "POST", body: "{}" });
  }
}

const response = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "content-type": "application/json" }),
  });

afterEach(() => {
  fetchMock.mockReset();
  vi.mocked(retryDelay).mockClear();
});

describe("control transport GET retries", () => {
  test("retries transient statuses and returns the successful response", async () => {
    fetchMock.mockResolvedValueOnce(response(502, "Bad Gateway")).mockResolvedValueOnce(response(200, { ok: true }));
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.get("/test")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledTimes(1);
  });

  test("stops after three attempts", async () => {
    fetchMock.mockResolvedValue(response(503, "Service Unavailable"));
    const service = new TestService("key", "https://api.example.com", 1_000);
    const error = await service.get("/test").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect((error as HyperbrowserError).statusCode).toBe(503);
    expect((error as HyperbrowserError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("does not retry non-retryable statuses", async () => {
    fetchMock.mockResolvedValue(response(404, { message: "missing" }));
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.get("/test")).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries network failures on GET only", async () => {
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    fetchMock.mockRejectedValueOnce(reset).mockResolvedValueOnce(response(200, { ok: true }));
    const service = new TestService("key", "https://api.example.com", 1_000);
    await expect(service.get("/test")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response(502, "Bad Gateway"));
    await expect(service.post("/test")).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
