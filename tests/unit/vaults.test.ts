import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { HyperbrowserClient as Hyperbrowser, HyperbrowserError } from "../../src/client";
import { VaultsService } from "../../src/services/vaults";
import type { Vault, VaultEntry } from "../../src/types";

const ID = "6f1d3c1e-5b8a-4e6f-9a51-0c2b7f3d9e10";
const UUID_NAME = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const stored = (overrides: Record<string, unknown> = {}): Vault => ({
  id: ID,
  name: "github-login",
  description: "",
  entries: {
    USERNAME: { name: "github-username", secretId: "s1", version: null },
    PASSWORD: { name: "github-password", secretId: "s2", version: 3 },
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const listOf = (...vaults: unknown[]) => ({
  vaults,
  totalCount: vaults.length,
  page: 1,
  perPage: 100,
});

const notFound = () =>
  new HyperbrowserError("Vault not found", { statusCode: 404, code: "VAULT_NOT_FOUND" });

/** Routes `request(path, init, params)` calls to `handler(method, path, body, params)`. */
const mockService = (
  handler: (method: string, path: string, body: any, params: any) => unknown
) => {
  const service = new VaultsService("test-key", "https://api.example.com", 30_000);
  const requestSpy = vi
    .spyOn(service as any, "request")
    .mockImplementation(async (path: any, init: any, params: any) => {
      const result = handler(
        init?.method ?? "GET",
        path,
        init?.body ? JSON.parse(init.body) : undefined,
        params
      );
      if (result instanceof Error) throw result;
      return result;
    });
  const calls = () =>
    requestSpy.mock.calls.map(([path, init]: any[]) => `${init?.method ?? "GET"} ${path}`);
  const bodies = () =>
    requestSpy.mock.calls.map(([, init]: any[]) =>
      init?.body ? JSON.parse(init.body) : undefined
    );
  return { service, requestSpy, calls, bodies };
};

describe("vaults service", () => {
  test("the client exposes vaults", () => {
    expect(new Hyperbrowser({ apiKey: "k" }).vaults).toBeInstanceOf(VaultsService);
    expectTypeOf<Vault["entries"]>().toEqualTypeOf<Record<string, VaultEntry>>();
  });

  test("create sends a stored vault in the API's shape", async () => {
    const { service, calls, bodies } = mockService(() => stored());
    const vault = await service.create({
      name: "github-login",
      description: "GitHub bot",
      entries: {
        USERNAME: { name: "github-username" },
        PASSWORD: { name: "github-password", version: 3 },
        OTP: { name: "github-otp", version: "latest" },
      },
    });
    expect(calls()).toEqual(["POST /vaults"]);
    expect(bodies()[0]).toEqual({
      name: "github-login",
      description: "GitHub bot",
      entries: {
        USERNAME: { name: "github-username" },
        PASSWORD: { name: "github-password", version: 3 },
        OTP: { name: "github-otp", version: "latest" },
      },
    });
    expect(vault).toEqual(stored());
  });

  test.each<[string, unknown]>([
    ["a bad vault name", { name: "github login" }],
    ["a bad env name", { name: "v", entries: { "1BAD": { name: "s" } } }],
    ["__proto__", { name: "v", entries: JSON.parse('{"__proto__": {"name": "s"}}') }],
    ["a long env name", { name: "v", entries: { ["A".repeat(257)]: { name: "s" } } }],
    ["a bad secret name", { name: "v", entries: { A: { name: "-s" } } }],
    ["version 0", { name: "v", entries: { A: { name: "s", version: 0 } } }],
    ["a removal on create", { name: "v", entries: { A: null } }],
    ["a 1Password entry", { name: "v", entries: { A: { item: "i", field: "f" } } }],
    ["a non-object entry", { name: "v", entries: { A: "s" } }],
    [
      "33 entries",
      {
        name: "v",
        entries: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`E${i}`, { name: "s" }])),
      },
    ],
  ])("create rejects %s before any request", async (_name, params) => {
    const { service, calls } = mockService(() => stored());
    await expect(service.create(params as any)).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(calls()).toEqual([]);
  });

  test("a vault with a stray source still parses", async () => {
    const withSource = { ...stored(), source: { type: "stored" } };
    const { service } = mockService((_method, path) =>
      path === "/vaults" ? listOf(withSource) : withSource
    );
    await expect(service.get(ID)).resolves.toMatchObject({ entries: stored().entries });
    await expect(service.list()).resolves.toMatchObject({
      vaults: [{ name: "github-login", entries: stored().entries }],
    });
  });

  test("names resolve by exact match through a search; IDs resolve directly", async () => {
    const { service, calls, requestSpy } = mockService((_method, path, _body, params) => {
      if (path === "/vaults") {
        expect(params).toMatchObject({ search: "github-login", limit: 100 });
        return listOf(stored({ name: "github-login-old", id: "other" }), stored());
      }
      return stored();
    });
    await expect(service.get("github-login")).resolves.toMatchObject({ id: ID });
    await expect(service.get(` ${ID} `)).resolves.toMatchObject({ name: "github-login" });
    expect(calls()).toEqual(["GET /vaults", `GET /vaults/${ID}`]);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  test("a UUID-shaped name falls back to a name search after a 404", async () => {
    const { service, calls } = mockService((_method, path) => {
      if (path === `/vaults/${UUID_NAME}`) return notFound();
      return listOf(stored({ name: UUID_NAME }));
    });
    await expect(service.get(UUID_NAME)).resolves.toMatchObject({ name: UUID_NAME });
    expect(calls()).toEqual([`GET /vaults/${UUID_NAME}`, "GET /vaults"]);
  });

  test("a missing vault is VAULT_NOT_FOUND", async () => {
    const { service } = mockService(() => listOf(stored({ name: "github-login-2" })));
    await expect(service.delete("github-login")).rejects.toMatchObject({
      statusCode: 404,
      code: "VAULT_NOT_FOUND",
    });
  });

  test("update and delete use the resolved ID", async () => {
    const { service, calls, bodies } = mockService((method, path) => {
      if (path === "/vaults") return listOf(stored());
      if (method === "DELETE") return { deleted: true, id: ID, name: "github-login" };
      return stored();
    });
    await service.update("github-login", {
      description: "new",
      entries: { OTP: { name: "github-otp" }, PASSWORD: null },
    });
    await service.update("github-login", { entries: { OTP: { name: "github-otp", version: 2 } } });
    await expect(service.delete("github-login")).resolves.toEqual({
      deleted: true,
      id: ID,
      name: "github-login",
    });
    expect(calls()).toEqual([
      "GET /vaults",
      `PATCH /vaults/${ID}`,
      "GET /vaults",
      `PATCH /vaults/${ID}`,
      "GET /vaults",
      `DELETE /vaults/${ID}`,
    ]);
    expect(bodies()[1]).toEqual({
      description: "new",
      entries: { OTP: { name: "github-otp" }, PASSWORD: null },
    });
    expect(bodies()[3]).toEqual({ entries: { OTP: { name: "github-otp", version: 2 } } });
  });

  test.each([
    ["nothing", {}],
    ["only a source", { source: { tokenSecret: "op-token" } }],
    ["a 1Password entry", { entries: { A: { item: "i", field: "f" } } }],
    ["a bad entry", { entries: { A: { name: "" } } }],
    ["a long description", { description: "d".repeat(1025) }],
  ])("update rejects %s before any request", async (_name, params) => {
    const { service, calls } = mockService(() => stored());
    await expect(service.update("github-login", params as any)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(calls()).toEqual([]);
  });

  test("list passes pagination and search, and checks them", async () => {
    const { service, requestSpy } = mockService(() => listOf(stored()));
    await service.list({ page: 2, limit: 10, search: "github" });
    expect(requestSpy.mock.calls[0][2]).toEqual({ search: "github", page: 2, limit: 10 });
    await expect(service.list({ limit: 101 })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.list({ page: 0 })).rejects.toMatchObject({ code: "invalid_request" });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("API errors pass through with their code", async () => {
    const taken = new HyperbrowserError("A vault with this name already exists", {
      statusCode: 409,
      code: "VAULT_NAME_TAKEN",
    });
    const { service } = mockService(() => taken);
    await expect(service.create({ name: "github-login" })).rejects.toBe(taken);
  });
});
