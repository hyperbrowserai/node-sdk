import crypto from "crypto";
import { describe, expect, test, vi } from "vitest";
import { HyperbrowserError } from "../../src/client";
import { SecretsSealer } from "../../src/secrets-envelope";
import { SecretsService } from "../../src/services/secrets";
import type { SecretsPublicKey } from "../../src/types";

const ID = "6f1d3c1e-5b8a-4e6f-9a51-0c2b7f3d9e10";
const UUID_NAME = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const keyPair = (bits: number, publicExponent = 65537) =>
  crypto.generateKeyPairSync("rsa", { modulusLength: bits, publicExponent });

const publicKeyFor = (publicKey: crypto.KeyObject): SecretsPublicKey => {
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const kid = crypto
    .createHash("sha256")
    .update(`{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`)
    .digest("base64url");
  return { kid, alg: "RSA-OAEP-256", enc: "A256GCM", jwk: { kty: "RSA", n: jwk.n, e: jwk.e } };
};

const platformKey = keyPair(3072);
const platformPublicKey = publicKeyFor(platformKey.publicKey);

const open = (envelope: string) => {
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = envelope.split(".");
  const cek = crypto.privateDecrypt(
    {
      key: platformKey.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encryptedKey, "base64url")
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", cek, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return {
    header: JSON.parse(Buffer.from(protectedHeader, "base64url").toString()),
    value: Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]),
  };
};

const secret = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: "provider-key",
  description: "",
  encryptionContext: `hyperbrowser:secret:v1:team:${ID}`,
  latestVersion: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const notFound = () =>
  new HyperbrowserError("Secret not found", { statusCode: 404, code: "SECRET_NOT_FOUND" });

/** Routes `request(path, init, params)` calls to `handler(method, path, body, params)`. */
const mockService = (
  handler: (method: string, path: string, body: any, params: any) => unknown
) => {
  const service = new SecretsService("test-key", "https://api.example.com", 30_000);
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
  return { service, requestSpy, calls };
};

describe("secret envelopes", () => {
  test("seal produces a compact JWE the platform key can open", () => {
    const sealer = SecretsSealer.fromPublicKey(platformPublicKey);
    const envelope = sealer.seal("ctx-1", "value with newline\n");
    expect(envelope.split(".")).toHaveLength(5);
    const { header, value } = open(envelope);
    expect(header).toEqual({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: platformPublicKey.kid,
      ctx: "ctx-1",
    });
    expect(value.toString()).toBe("value with newline\n");
  });

  test("bytes are sealed byte-for-byte", () => {
    const sealer = SecretsSealer.fromPublicKey(platformPublicKey);
    const bytes = new Uint8Array([0x68, 0xc3, 0xa9, 0x0a]);
    expect(open(sealer.seal("ctx", bytes)).value).toEqual(Buffer.from(bytes));
  });

  test("keys whose ID does not match are refused", () => {
    expect(() =>
      SecretsSealer.fromPublicKey({ ...platformPublicKey, kid: "not-the-thumbprint" })
    ).toThrow(/does not match its key ID/);
  });

  test("keys outside the platform policy are refused", () => {
    expect(() => SecretsSealer.fromPublicKey(publicKeyFor(keyPair(2048).publicKey))).toThrow(
      /at least 3072-bit/
    );
    expect(() => SecretsSealer.fromPublicKey(publicKeyFor(keyPair(3072, 3).publicKey))).toThrow(
      /exponent 65537/
    );
    expect(() => SecretsSealer.fromPublicKey({ ...platformPublicKey, alg: "RSA1_5" })).toThrow(
      /Unsupported/
    );
  });

  test.each([
    ["empty", ""],
    ["too large", "x".repeat(32 * 1024 + 1)],
    ["NUL", "a\0b"],
    ["invalid UTF-8", new Uint8Array([0xff, 0xfe])],
  ])("value rules: %s", (_name, value) => {
    const sealer = SecretsSealer.fromPublicKey(platformPublicKey);
    expect(() => sealer.seal("ctx", value)).toThrow(HyperbrowserError);
  });

  test("the largest allowed value is accepted", () => {
    const sealer = SecretsSealer.fromPublicKey(platformPublicKey);
    expect(open(sealer.seal("ctx", "x".repeat(32 * 1024))).value).toHaveLength(32 * 1024);
  });
});

describe("secrets service", () => {
  test("create with a value checks the key first, then uploads only an envelope", async () => {
    const { service, calls, requestSpy } = mockService((method, path) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (method === "POST" && path === "/secrets") return secret();
      if (method === "POST" && path === `/secrets/${ID}/versions`)
        return { version: 1, kid: platformPublicKey.kid, createdAt: "2026-10-01T00:00:00.000Z" };
      throw new Error(`unexpected ${method} ${path}`);
    });

    const created = await service.create({ name: "provider-key", value: "s3cret" });

    expect(calls()).toEqual([
      "GET /secrets/public-key",
      "POST /secrets",
      `POST /secrets/${ID}/versions`,
    ]);
    expect(JSON.parse((requestSpy.mock.calls[1][1] as any).body)).toEqual({ name: "provider-key" });
    const upload = JSON.parse((requestSpy.mock.calls[2][1] as any).body);
    expect(Object.keys(upload)).toEqual(["envelope"]);
    expect(upload.envelope).not.toContain("s3cret");
    const { header, value } = open(upload.envelope);
    expect(header.ctx).toBe(secret().encryptionContext);
    expect(value.toString()).toBe("s3cret");
    expect(created.latestVersion).toBe(1);
  });

  test("an invalid value or an unusable key never creates a secret", async () => {
    const { service, calls } = mockService((_method, path) => {
      if (path === "/secrets/public-key") return { ...platformPublicKey, kid: "wrong" };
      return secret();
    });
    await expect(service.create({ name: "provider-key", value: "" })).rejects.toThrow(/empty/);
    await expect(service.create({ name: "provider-key", value: "ok" })).rejects.toThrow(/key ID/);
    expect(calls()).toEqual(["GET /secrets/public-key"]);
  });

  test("a failed upload after creating reports the partial create", async () => {
    const { service } = mockService((method, path) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (method === "POST" && path === "/secrets") return secret();
      return new HyperbrowserError("key outdated", {
        statusCode: 409,
        code: "SECRET_KEY_OUTDATED",
      });
    });
    const error = await service.create({ name: "provider-key", value: "v" }).catch((e) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error.code).toBe("secret_value_not_stored");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain(`provider-key (${ID}) was created`);
    expect(error.message).toContain("key outdated");
    expect(error.details).toEqual({ secret: secret() });
  });

  test("an ID resolves without a name search", async () => {
    const detail = { ...secret(), versions: [] };
    const { service, calls } = mockService(() => detail);
    await expect(service.get(ID)).resolves.toEqual(detail);
    expect(calls()).toEqual([`GET /secrets/${ID}`]);
  });

  test("a UUID-shaped name falls back to a name search after a 404", async () => {
    const named = secret({ id: ID, name: UUID_NAME });
    const { service, calls, requestSpy } = mockService((_method, path) => {
      if (path === `/secrets/${UUID_NAME}`) return notFound();
      if (path === "/secrets") return { secrets: [named], totalCount: 1, page: 1, perPage: 100 };
      return { ...named, versions: [] };
    });
    await expect(service.get(UUID_NAME)).resolves.toMatchObject({ name: UUID_NAME });
    expect(calls()).toEqual([`GET /secrets/${UUID_NAME}`, "GET /secrets", `GET /secrets/${ID}`]);
    expect(requestSpy.mock.calls[1][2]).toEqual({ search: UUID_NAME, page: undefined, limit: 100 });
  });

  test("other ID lookup errors are reported without a name search", async () => {
    const { service, calls } = mockService(
      () => new HyperbrowserError("boom", { statusCode: 500 })
    );
    await expect(service.get(ID)).rejects.toMatchObject({ statusCode: 500 });
    expect(calls()).toEqual([`GET /secrets/${ID}`]);
  });

  test("names match exactly, not by prefix", async () => {
    const { service } = mockService(() => ({
      secrets: [secret({ name: "provider-key-old" })],
      totalCount: 1,
      page: 1,
      perPage: 100,
    }));
    await expect(service.delete("provider-key")).rejects.toMatchObject({
      statusCode: 404,
      code: "SECRET_NOT_FOUND",
    });
  });

  test("addVersion, update, delete and deleteVersion use the resolved ID", async () => {
    const { service, calls, requestSpy } = mockService((method, path) => {
      if (path === "/secrets") return { secrets: [secret()], totalCount: 1, page: 1, perPage: 100 };
      if (path === "/secrets/public-key") return platformPublicKey;
      if (method === "POST") return { version: 2, kid: platformPublicKey.kid, createdAt: "" };
      if (method === "PATCH") return secret({ description: "rotated monthly" });
      if (path.includes("/versions/")) return { deleted: true, version: 1 };
      return { deleted: true, id: ID, name: "provider-key" };
    });

    await expect(service.addVersion("provider-key", "next")).resolves.toMatchObject({ version: 2 });
    await expect(
      service.update("provider-key", { description: "rotated monthly" })
    ).resolves.toMatchObject({ description: "rotated monthly" });
    await expect(service.deleteVersion("provider-key", 1)).resolves.toEqual({
      deleted: true,
      version: 1,
    });
    await expect(service.delete("provider-key")).resolves.toEqual({
      deleted: true,
      id: ID,
      name: "provider-key",
    });
    expect(calls()).toEqual([
      "GET /secrets/public-key",
      "GET /secrets",
      `POST /secrets/${ID}/versions`,
      "GET /secrets",
      `PATCH /secrets/${ID}`,
      "GET /secrets",
      `DELETE /secrets/${ID}/versions/1`,
      "GET /secrets",
      `DELETE /secrets/${ID}`,
    ]);
    expect(JSON.parse((requestSpy.mock.calls[4][1] as any).body)).toEqual({
      description: "rotated monthly",
    });
  });
});
