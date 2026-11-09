import crypto from "crypto";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { HyperbrowserError } from "../../src/client";
import { createCustomerKey, CustomerKey, secretEnvelopeDigest } from "../../src/customer-key";
import { SecretsSealer } from "../../src/secrets-envelope";
import { SecretsService } from "../../src/services/secrets";
import { VaultsService } from "../../src/services/vaults";
import type {
  SandboxSecretReference,
  SandboxVaultSource,
  SecretsPublicKey,
  UnwrappedSecretReference,
  VaultReference,
  WrappedSecretVersion,
} from "../../src/types";

const ID = "6f1d3c1e-5b8a-4e6f-9a51-0c2b7f3d9e10";
const VAULT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONTEXT = `hb-secret-v1:team-1:${ID}`;

const platformKey = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
const platformPublicKey: SecretsPublicKey = (() => {
  const jwk = platformKey.publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const kid = crypto
    .createHash("sha256")
    .update(`{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`)
    .digest("base64url");
  return { kid, alg: "RSA-OAEP-256", enc: "A256GCM", jwk: { kty: "RSA", n: jwk.n, e: jwk.e } };
})();

/** Opens an inner envelope with the platform key, as vm-service would. */
const openInner = (envelope: string) => {
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
    value: Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString(),
  };
};

const headerOf = (envelope: string) =>
  JSON.parse(Buffer.from(envelope.split(".")[0], "base64url").toString());

const rsaKey = createCustomerKey(
  crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
);
const ecKey = createCustomerKey(
  crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
);

const secret = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: "db-password",
  description: "",
  type: "secret",
  metadata: {},
  protection: "customer",
  encryptionContext: CONTEXT,
  latestVersion: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

/** Routes `request(path, init, params)` calls to `handler(method, path, body, params)`. */
const mockService = <T extends SecretsService | VaultsService>(
  service: T,
  handler: (method: string, path: string, body: any, params: any) => unknown
) => {
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

const secrets = () => new SecretsService("test-key", "https://api.example.com", 30_000);

/** A stored customer-protected version: `value` sealed to the platform and wrapped with `key`. */
const storedVersion = (
  value: string,
  key: CustomerKey,
  version = 1
): WrappedSecretVersion & { inner: string } => {
  const sealer = SecretsSealer.fromPublicKey(platformPublicKey);
  const inner = sealer.seal(CONTEXT, value);
  return {
    version,
    kid: platformPublicKey.kid,
    retiresAt: null,
    outerKid: key.kid,
    innerDigest: secretEnvelopeDigest(inner),
    envelope: key.wrap(inner, CONTEXT) as string,
    inner,
  };
};

describe("customer keys", () => {
  test("secretEnvelopeDigest is the base64url SHA-256 of the envelope", () => {
    expect(secretEnvelopeDigest("a.b.c.d.e")).toBe(
      crypto.createHash("sha256").update("a.b.c.d.e").digest("base64url")
    );
    expect(secretEnvelopeDigest("a.b.c.d.e")).toHaveLength(43);
  });

  test.each([
    ["RSA", () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), "RSA-OAEP-256"],
    ["P-384", () => crypto.generateKeyPairSync("ec", { namedCurve: "P-384" }), "ECDH-ES+A256KW"],
    ["P-521", () => crypto.generateKeyPairSync("ec", { namedCurve: "P-521" }), "ECDH-ES+A256KW"],
    ["X25519", () => crypto.generateKeyPairSync("x25519"), "ECDH-ES+A256KW"],
    ["X448", () => crypto.generateKeyPairSync("x448"), "ECDH-ES+A256KW"],
  ])("%s keys wrap to the secret's context and unwrap", (_label, generate, alg) => {
    const { privateKey } = generate();
    const key = createCustomerKey(privateKey);
    const inner = "header.key.iv.ciphertext.tag";
    const wrapped = key.wrap(inner, CONTEXT) as string;
    const header = headerOf(wrapped);
    expect(header).toMatchObject({ alg, enc: "A256GCM", kid: key.kid, ctx: CONTEXT });
    expect(Object.keys(header).sort()).toEqual(
      alg === "RSA-OAEP-256" ? ["alg", "ctx", "enc", "kid"] : ["alg", "ctx", "enc", "epk", "kid"]
    );
    expect(key.unwrap(wrapped)).toBe(inner);
  });

  test("direct ECDH-ES leaves the encrypted key empty", () => {
    const key = createCustomerKey(crypto.generateKeyPairSync("x25519").privateKey, {
      algorithm: "ECDH-ES",
    });
    const wrapped = key.wrap("a.b.c.d.e", CONTEXT) as string;
    expect(wrapped.split(".")[1]).toBe("");
    expect(headerOf(wrapped).alg).toBe("ECDH-ES");
    expect(key.unwrap(wrapped)).toBe("a.b.c.d.e");
  });

  test("the kid is the RFC 7638 thumbprint unless the JWK or options name one", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const thumbprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
      .digest("base64url");
    expect(createCustomerKey(privateKey).kid).toBe(thumbprint);
    expect(createCustomerKey(publicKey).kid).toBe(thumbprint);
    expect(createCustomerKey(publicKey.export({ type: "spki", format: "pem" })).kid).toBe(
      thumbprint
    );
    expect(createCustomerKey({ ...jwk, kid: "team-key-2026" }).kid).toBe("team-key-2026");
    expect(createCustomerKey(privateKey, { kid: "kms/key-1" }).kid).toBe("kms/key-1");
  });

  test("PEM and JWK private keys unwrap; public keys only wrap", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fromPem = createCustomerKey(privateKey.export({ type: "pkcs8", format: "pem" }));
    const fromJwk = createCustomerKey(privateKey.export({ format: "jwk" }));
    const publicOnly = createCustomerKey(publicKey);
    expect(fromPem.canUnwrap && fromJwk.canUnwrap).toBe(true);
    expect(publicOnly.canUnwrap).toBe(false);
    const wrapped = publicOnly.wrap("a.b.c.d.e", CONTEXT) as string;
    expect(fromPem.unwrap(wrapped)).toBe("a.b.c.d.e");
    expect(fromJwk.unwrap(wrapped)).toBe("a.b.c.d.e");
    expect(() => publicOnly.unwrap(wrapped)).toThrow(
      expect.objectContaining({ code: "customer_key_private_key_required" })
    );
  });

  test("keys the API would refuse are rejected", () => {
    const small = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
    const k256 = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    const ed = crypto.generateKeyPairSync("ed25519").privateKey;
    for (const key of [small, k256, ed]) {
      expect(() => createCustomerKey(key)).toThrow(
        expect.objectContaining({ code: "invalid_customer_key" })
      );
    }
    expect(() => createCustomerKey(crypto.createSecretKey(Buffer.alloc(32)))).toThrow(/asymmetric/);
    expect(() => createCustomerKey("not a key")).toThrow(/PEM or DER/);
    expect(() => createCustomerKey(rsaKeyObject(), { algorithm: "ECDH-ES" })).toThrow(
      /RSA-OAEP-256/
    );
    expect(() => createCustomerKey(rsaKeyObject(), { kid: "caf\u00e9" })).toThrow(
      /printable ASCII/
    );
    expect(() => createCustomerKey(rsaKeyObject(), { kid: "x".repeat(257) })).toThrow(/1-256/);
  });

  test("unwrapping names a key mismatch and refuses a tampered envelope", () => {
    const wrapped = rsaKey.wrap("a.b.c.d.e", CONTEXT) as string;
    expect(() => ecKey.unwrap(wrapped)).toThrow(
      expect.objectContaining({ code: "customer_key_mismatch" })
    );
    const segments = wrapped.split(".");
    const tag = Buffer.from(segments[4], "base64url");
    tag[0] ^= 1;
    segments[4] = tag.toString("base64url");
    expect(() => rsaKey.unwrap(segments.join("."))).toThrow(
      expect.objectContaining({ code: "customer_key_unwrap_failed" })
    );
    expect(() => rsaKey.unwrap("a.b.c")).toThrow(/five segments/);
  });
});

function rsaKeyObject() {
  return crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
}

describe("customer-protected secrets", () => {
  test("create wraps the first value with the customer key", async () => {
    const { service, calls, bodies } = mockService(secrets(), (method, path) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (method === "POST" && path === "/secrets") return secret();
      if (method === "POST" && path === `/secrets/${ID}/versions`) {
        return { version: 1, kid: platformPublicKey.kid, outerKid: rsaKey.kid, retiresAt: null };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    const created = await service.create({
      name: "db-password",
      value: "hunter2",
      customerKey: rsaKey,
    });

    expect(created.latestVersion).toBe(1);
    expect(calls()).toEqual([
      "GET /secrets/public-key",
      "POST /secrets",
      `POST /secrets/${ID}/versions`,
    ]);
    expect(bodies()[1]).toEqual({ name: "db-password", protection: "customer" });
    const upload = bodies()[2];
    expect(Object.keys(upload).sort()).toEqual(["envelope", "innerDigest", "innerKid"]);
    expect(upload.innerKid).toBe(platformPublicKey.kid);
    expect(headerOf(upload.envelope)).toMatchObject({ kid: rsaKey.kid, ctx: CONTEXT });
    const inner = rsaKey.unwrap(upload.envelope) as string;
    expect(secretEnvelopeDigest(inner)).toBe(upload.innerDigest);
    expect(openInner(inner)).toMatchObject({
      header: { kid: platformPublicKey.kid, ctx: CONTEXT },
      value: "hunter2",
    });
  });

  test("create sends protection without a value, and checks keys before any request", async () => {
    const { service, calls, bodies } = mockService(secrets(), () => secret());
    await service.create({ name: "db-password", protection: "customer" });
    expect(bodies()).toEqual([{ name: "db-password", protection: "customer" }]);

    for (const params of [
      { name: "db-password", protection: "customer" as const, value: "v" },
      { name: "db-password", protection: "platform" as const, customerKey: rsaKey },
      { name: "db-password", customerKey: {} as CustomerKey },
      { name: "db-password", protection: "vendor" as any },
    ]) {
      await expect(service.create(params)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(calls()).toEqual(["POST /secrets"]);
  });

  test("addVersion wraps for customer-protected secrets and refuses a mismatched key option", async () => {
    let protection = "customer";
    const { service, calls, bodies } = mockService(secrets(), (method, path) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (path === `/secrets/${ID}`) return { ...secret({ protection }), versions: [] };
      if (method === "POST") return { version: 2, kid: platformPublicKey.kid, outerKid: ecKey.kid };
      throw new Error(`unexpected ${method} ${path}`);
    });

    await service.addVersion(ID, "hunter3", { customerKey: ecKey });
    const upload = bodies()[2];
    expect(openInner(ecKey.unwrap(upload.envelope) as string).value).toBe("hunter3");
    expect(upload.innerDigest).toBe(secretEnvelopeDigest(ecKey.unwrap(upload.envelope) as string));

    await expect(service.addVersion(ID, "v")).rejects.toThrow(
      /customer-protected: pass customerKey/
    );
    protection = "platform";
    await expect(service.addVersion(ID, "v", { customerKey: ecKey })).rejects.toThrow(
      /not customer-protected/
    );
    expect(calls().filter((call) => call.startsWith("POST"))).toHaveLength(1);
  });

  test("unwrap returns a pinned reference whose envelope matches the stored digest", async () => {
    const stored = storedVersion("hunter2", rsaKey, 4);
    const { service, calls } = mockService(secrets(), (_method, path) => {
      if (path === `/secrets/${ID}`) return { ...secret({ latestVersion: 4 }), versions: [] };
      if (path === `/secrets/${ID}/versions/latest/wrapped`) return stored;
      if (path === `/secrets/${ID}/versions/4/wrapped`) return stored;
      throw new Error(`unexpected ${path}`);
    });

    const reference = await service.unwrap(ID, [ecKey, rsaKey]);
    expectTypeOf(reference).toEqualTypeOf<UnwrappedSecretReference>();
    expectTypeOf(reference).toMatchTypeOf<SandboxSecretReference>();
    expect(reference).toEqual({ name: "db-password", version: 4, unwrapped: stored.inner });
    await service.unwrap(ID, rsaKey, { version: 4 });
    expect(calls()).toEqual([
      `GET /secrets/${ID}`,
      `GET /secrets/${ID}/versions/latest/wrapped`,
      `GET /secrets/${ID}`,
      `GET /secrets/${ID}/versions/4/wrapped`,
    ]);
  });

  test("unwrap refuses a key that didn't wrap the version, and a digest mismatch", async () => {
    let stored: WrappedSecretVersion = storedVersion("hunter2", rsaKey);
    const { service } = mockService(secrets(), (_method, path) =>
      path.endsWith("/wrapped") ? stored : { ...secret(), versions: [] }
    );
    await expect(service.unwrap(ID, ecKey)).rejects.toMatchObject({
      code: "customer_key_mismatch",
    });
    stored = { ...stored, innerDigest: secretEnvelopeDigest("something else") };
    await expect(service.unwrap(ID, rsaKey)).rejects.toThrow(/doesn't match its innerDigest/);
    await expect(service.unwrap(ID, [])).rejects.toThrow(/at least one customer key/);
  });

  test("getWrappedVersion fetches a version's outer envelope", async () => {
    const stored = storedVersion("hunter2", rsaKey, 2);
    const { service, calls } = mockService(secrets(), (_method, path) =>
      path.endsWith("/wrapped") ? stored : { ...secret(), versions: [] }
    );
    await expect(service.getWrappedVersion(ID, 2)).resolves.toEqual(stored);
    await expect(service.getWrappedVersion(ID, 0)).rejects.toThrow(/version must be/);
    expect(calls()).toEqual([`GET /secrets/${ID}`, `GET /secrets/${ID}/versions/2/wrapped`]);
  });

  test("rewrap moves every version not yet on the new key, keeping the inner envelope", async () => {
    const v1 = storedVersion("one", rsaKey, 1);
    const v2 = storedVersion("two", rsaKey, 2);
    const v3 = storedVersion("three", ecKey, 3);
    const byVersion: Record<number, WrappedSecretVersion & { inner: string }> = {
      1: v1,
      2: v2,
      3: v3,
    };
    const { service, calls, bodies } = mockService(secrets(), (method, path, body) => {
      if (path === `/secrets/${ID}`) {
        return {
          ...secret({ latestVersion: 3 }),
          versions: [v3, v2, v1].map(({ version, kid, outerKid }) => ({ version, kid, outerKid })),
        };
      }
      const match = /\/versions\/(\d+)\/(wrapped|wrapping)$/.exec(path)!;
      const stored = byVersion[Number(match[1])];
      if (method === "GET") return stored;
      return { ...stored, envelope: body.envelope, outerKid: headerOf(body.envelope).kid };
    });

    const rewrapped = await service.rewrap(ID, { from: rsaKey, to: ecKey });

    expect(calls()).toEqual([
      `GET /secrets/${ID}`,
      `GET /secrets/${ID}/versions/2/wrapped`,
      `PUT /secrets/${ID}/versions/2/wrapping`,
      `GET /secrets/${ID}/versions/1/wrapped`,
      `PUT /secrets/${ID}/versions/1/wrapping`,
    ]);
    expect(rewrapped.map(({ version, outerKid }) => [version, outerKid])).toEqual([
      [2, ecKey.kid],
      [1, ecKey.kid],
    ]);
    const puts = bodies().filter((body) => body !== undefined);
    expect(puts[0].innerDigest).toBe(v2.innerDigest);
    expect(ecKey.unwrap(puts[0].envelope)).toBe(v2.inner);
    expect(headerOf(puts[1].envelope).ctx).toBe(CONTEXT);
    expect(ecKey.unwrap(puts[1].envelope)).toBe(v1.inner);
  });

  test("rewrap refuses platform secrets, and replaceVersionWrapping sends the envelope as given", async () => {
    const { service, calls, bodies } = mockService(secrets(), (method, path) => {
      if (path === `/secrets/${ID}`) return { ...secret({ protection: "platform" }), versions: [] };
      if (method === "PUT") return storedVersion("x", ecKey, 5);
      throw new Error(`unexpected ${path}`);
    });
    await expect(service.rewrap(ID, { from: rsaKey, to: ecKey })).rejects.toThrow(
      /not customer-protected/
    );
    await service.replaceVersionWrapping(ID, 5, { envelope: "outer", innerDigest: "digest" });
    expect(calls()).toEqual([
      `GET /secrets/${ID}`,
      `GET /secrets/${ID}`,
      `PUT /secrets/${ID}/versions/5/wrapping`,
    ]);
    expect(bodies()[2]).toEqual({ envelope: "outer", innerDigest: "digest" });
    await expect(
      service.replaceVersionWrapping(ID, 5, { envelope: "", innerDigest: "digest" })
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("version details keep outerKid and retiresAt", async () => {
    const versions = [
      {
        version: 2,
        kid: "p",
        outerKid: rsaKey.kid,
        retiresAt: "2027-01-01T00:00:00.000Z",
        createdAt: "x",
      },
    ];
    const { service } = mockService(secrets(), () => ({ ...secret(), versions }));
    const detail = await service.get(ID);
    expect(detail.protection).toBe("customer");
    expect(detail.versions).toEqual(versions);
  });
});

describe("customer-protected vaults", () => {
  const vaults = () => new VaultsService("test-key", "https://api.example.com", 30_000);
  const vault = {
    id: VAULT_ID,
    name: "app-env",
    description: "",
    entries: {
      DB_PASSWORD: { name: "db-password", secretId: ID, version: null, protection: "customer" },
      API_KEY: { name: "api-key", secretId: "s2", version: 3, protection: "platform" },
    },
    createdAt: "x",
    updatedAt: "x",
  };

  test("unwrap returns the vault reference sandboxes and processes take", async () => {
    const stored = storedVersion("hunter2", ecKey, 7);
    const { service, calls } = mockService(vaults(), (_method, path) => {
      if (path === `/vaults/${VAULT_ID}`) return vault;
      if (path === `/vaults/${VAULT_ID}/wrapped`) {
        return {
          id: VAULT_ID,
          name: "app-env",
          entries: { DB_PASSWORD: { ...stored, name: "db-password", secretId: ID } },
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const reference = await service.unwrap(VAULT_ID, [rsaKey, ecKey]);

    expectTypeOf(reference).toEqualTypeOf<VaultReference>();
    expectTypeOf(reference).toMatchTypeOf<SandboxVaultSource>();
    expect(reference).toEqual({
      name: "app-env",
      unwrapped: { DB_PASSWORD: { version: 7, unwrapped: stored.inner } },
    });
    expect(calls()).toEqual([`GET /vaults/${VAULT_ID}`, `GET /vaults/${VAULT_ID}/wrapped`]);
  });

  test("unwrap names the entry whose key is missing", async () => {
    const stored = storedVersion("hunter2", ecKey, 7);
    const { service } = mockService(vaults(), (_method, path) =>
      path.endsWith("/wrapped")
        ? {
            id: VAULT_ID,
            name: "app-env",
            entries: { DB_PASSWORD: { ...stored, name: "db-password", secretId: ID } },
          }
        : vault
    );
    const error = await service.unwrap(VAULT_ID, rsaKey).catch((e) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error).toMatchObject({ code: "customer_key_mismatch" });
    expect(error.message).toContain("Entry DB_PASSWORD of vault app-env");
  });

  test("a vault with no customer-protected entries unwraps to an empty reference", async () => {
    const { service, calls } = mockService(vaults(), (_method, path) => {
      if (path === "/vaults") return { vaults: [vault], total: 1, page: 1, limit: 100 };
      if (path === `/vaults/${VAULT_ID}/wrapped`)
        return { id: VAULT_ID, name: "app-env", entries: {} };
      throw new Error(`unexpected ${path}`);
    });
    await expect(service.unwrap("app-env", rsaKey)).resolves.toEqual({
      name: "app-env",
      unwrapped: {},
    });
    expect(calls()).toEqual(["GET /vaults", `GET /vaults/${VAULT_ID}/wrapped`]);
  });
});
