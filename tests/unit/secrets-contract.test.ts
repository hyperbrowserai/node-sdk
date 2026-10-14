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

  test("invalid names, list pages and version numbers are rejected locally", async () => {
    const { service, calls } = mockService(() => secret());
    for (const name of ["", "-leading-dash", "has space", "x".repeat(129)]) {
      await expect(service.create({ name })).rejects.toThrow(/Secret name must be/);
    }
    await expect(service.list({ limit: 0 })).rejects.toThrow(
      /limit must be an integer from 1 to 100/
    );
    await expect(service.list({ limit: 101 })).rejects.toThrow(/limit must be/);
    await expect(service.list({ limit: 1.5 })).rejects.toThrow(/limit must be/);
    await expect(service.list({ page: 0 })).rejects.toThrow(/page must be a positive integer/);
    await expect(service.deleteVersion("provider-key", 2 ** 31)).rejects.toThrow(
      /version must be an integer from 1 to 2147483647/
    );
    expect(calls()).toEqual([]);
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

describe("typed secrets and allowed origins", () => {
  const TOTP_CONTEXT = `hb-secret-v1:team:${ID}:totp`;
  const OP_CONTEXT = `hb-secret-v1:team:${ID}:op_token`;
  const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const totp = (overrides: Record<string, unknown> = {}) =>
    secret({
      name: "github-otp",
      type: "totp",
      metadata: {},
      encryptionContext: TOTP_CONTEXT,
      ...overrides,
    });
  const opToken = () =>
    secret({ name: "op-token", type: "op_token", metadata: {}, encryptionContext: OP_CONTEXT });
  const listOf = (item: unknown) => ({ secrets: [item], totalCount: 1, page: 1, perPage: 100 });
  const version = (n: number) => ({ version: n, kid: platformPublicKey.kid, createdAt: "" });
  const created = (item: unknown) => (method: string, path: string) => {
    if (path === "/secrets/public-key") return platformPublicKey;
    if (method === "POST" && path === "/secrets") return item;
    if (method === "POST" && path === `/secrets/${ID}/versions`) return version(1);
    throw new Error(`unexpected ${method} ${path}`);
  };

  test("create sends allowedOrigins as metadata.browser and seals to the returned context", async () => {
    const { service, calls, requestSpy } = mockService(
      created(
        secret({
          name: "github-password",
          metadata: { browser: { allowedOrigins: ["https://github.com"] } },
        })
      )
    );
    await service.create({
      name: "github-password",
      value: "pässwörd-1",
      allowedOrigins: ["https://github.com"],
      description: "GitHub bot",
    });
    expect(calls()).toEqual([
      "GET /secrets/public-key",
      "POST /secrets",
      `POST /secrets/${ID}/versions`,
    ]);
    expect(JSON.parse((requestSpy.mock.calls[1][1] as any).body)).toEqual({
      name: "github-password",
      description: "GitHub bot",
      metadata: { browser: { allowedOrigins: ["https://github.com"] } },
    });
    const { header, value } = open(JSON.parse((requestSpy.mock.calls[2][1] as any).body).envelope);
    expect(header.ctx).toBe(secret().encryptionContext);
    expect(value.toString("utf8")).toBe("pässwörd-1");
  });

  test("a TOTP seed is sealed as given to the TOTP context", async () => {
    const { service, requestSpy } = mockService(created(totp()));
    const result = await service.create({ name: "github-otp", type: "totp", value: SEED });
    expect(JSON.parse((requestSpy.mock.calls[1][1] as any).body)).toEqual({
      name: "github-otp",
      type: "totp",
    });
    const { header, value } = open(JSON.parse((requestSpy.mock.calls[2][1] as any).body).envelope);
    expect(header.ctx).toBe(TOTP_CONTEXT);
    expect(value.toString()).toBe(SEED);
    expect(result).toMatchObject({ type: "totp", latestVersion: 1 });
  });

  test.each([
    ["base32", SEED],
    ["lowercase with spaces and padding", "jbsw y3dp ehpk 3pxp===="],
    ["a byte-order mark", `\uFEFF${SEED}`],
    ["Go's spaces around it (NEL, NBSP, ideographic)", `\u0085\u00A0${SEED}\u3000`],
    ["a valid escape in the path and fragment", `otpauth://totp/50%25off?secret=${SEED}#a%20b`],
    ["a bad escape in another query parameter", `otpauth://totp/x?issuer=50%off&secret=${SEED}`],
    ["a padded integer", `otpauth://totp/x?secret=${SEED}&digits=0000000008`],
    ["hyphens and surrounding whitespace", "  JBSW-Y3DP-EHPK-3PXP\n"],
    ["a short seed (5 bytes)", "JBSWY3DP"],
    // The platform skips line breaks, as Go's base32 decoder does.
    ["a seed split across lines", "JBSWY3DPEHPK3\nPXP"],
    ["a seed split with CRLF", "JBSWY3DP\r\nEHPK3PXP"],
    // Go upper-cases one character at a time: "ı" reads as "I".
    ["a dotless i", "\u0131BSWY3DPEHPK3PXP"],
    ["an encoded line break in the URI secret", "otpauth://totp/x?secret=JBSWY3DP%0AEHPK3PXP"],
    ["an otpauth URI", `otpauth://totp/GitHub:ada?secret=${SEED}&issuer=GitHub`],
    [
      "an otpauth URI with every option",
      `otpauth://TOTP/x?secret=${SEED}&algorithm=sha512&digits=8&period=60`,
    ],
  ])("TOTP values accept %s", async (_name, value) => {
    const { service } = mockService(created(totp()));
    await expect(
      service.create({ name: "github-otp", type: "totp", value })
    ).resolves.toMatchObject({
      latestVersion: 1,
    });
  });

  test.each([
    ["not base32", "not-a-seed!"],
    ["digits outside base32", "JBSWY3DPEH1K3PXP"],
    ["a length of 1 mod 8", "JBSWY3DPE"],
    // ...but "ß" and "ﬀ" stay as they are rather than becoming "SS" and "FF".
    ["an eszett", "JBSWY3DPEHPK3P\u00df"],
    ["an ff ligature", "\ufb00AAAAAA"],
    ["a length of 3 mod 8", "JBSWY3DPEHP"],
    ["a length of 6 mod 8 after spaces, hyphens and padding", "jbsw-y3 dpeh pk3p xpjb swy3=="],
    ["'=' inside the seed", "JBSW=Y3DPEHPK3PXP"],
    ["another URI scheme", `https://totp/x?secret=${SEED}`],
    ["a HOTP URI", `otpauth://hotp/x?secret=${SEED}`],
    ["a tab in the URI", `otpauth://totp/x?secret=JBSWY3DP\tEHPK3PXP`],
    ["a newline in the URI", `otpauth://totp/x?issuer=a\nb&secret=${SEED}`],
    ["DEL in the URI", `otpauth://totp/x\u007f?secret=${SEED}`],
    ["a stray '%' in the path", `otpauth://totp/50%off:alice?secret=${SEED}`],
    ["a stray '%' in the fragment", `otpauth://totp/x?secret=${SEED}#50%off`],
    ["a bad escape in the secret", `otpauth://totp/x?secret=${SEED}%zz`],
    ["a byte-order mark after a space", ` \uFEFF${SEED}`],
    ["a trailing byte-order mark", `${SEED}\uFEFF`],
    ["a character that uppercases to ASCII", "JBSWY3DPEHPK3PXß"],
    ["a ligature that uppercases to ASCII", "JBSWY3DPEHPK3Pﬀ"],
    ["userinfo Go refuses", `otpauth://a b@totp/x?secret=${SEED}`],
    ["a URI secret with an impossible length", "otpauth://totp/x?secret=JBSWY3DPE"],
    ["a URI without a secret", "otpauth://totp/x?issuer=GitHub"],
    ["an unknown algorithm", `otpauth://totp/x?secret=${SEED}&algorithm=MD5`],
    ["7 digits", `otpauth://totp/x?secret=${SEED}&digits=7`],
    ["a period of 0", `otpauth://totp/x?secret=${SEED}&period=0`],
    ["a period over 300", `otpauth://totp/x?secret=${SEED}&period=301`],
  ])("TOTP values with %s fail locally without naming the value", async (_name, value) => {
    const { service, calls } = mockService(created(totp()));
    const error = await service.create({ name: "github-otp", type: "totp", value }).catch((e) => e);
    expect(error).toBeInstanceOf(HyperbrowserError);
    expect(error.code).toBe("invalid_secret_value");
    expect(error.message).toMatch(/TOTP/);
    expect(error.message).not.toContain(value);
    expect(calls()).toEqual([]);
  });

  test("short seeds are accepted without writing a warning", async () => {
    const warn = vi.spyOn(process, "emitWarning");
    try {
      const { service } = mockService(created(totp()));
      await service.create({ name: "github-otp", type: "totp", value: "JBSWY3DP" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("HOTP URIs are refused with their own message", async () => {
    const { service } = mockService(created(totp()));
    await expect(
      service.create({ name: "github-otp", type: "totp", value: `otpauth://hotp/x?secret=${SEED}` })
    ).rejects.toThrow(/HOTP .* not supported/);
  });

  test("op_token values are any string, and op_token secrets can't have allowed origins", async () => {
    const { service, calls, requestSpy } = mockService(created(opToken()));
    await service.create({ name: "op-token", type: "op_token", value: "not-an-ops-token" });
    expect(open(JSON.parse((requestSpy.mock.calls[2][1] as any).body).envelope).header.ctx).toBe(
      OP_CONTEXT
    );
    requestSpy.mockClear();
    await expect(
      service.create({
        name: "op-token",
        type: "op_token",
        value: "ops_x",
        allowedOrigins: ["https://a.com"],
      })
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(calls()).toEqual([]);
  });

  test("bad allowedOrigins fail before any request", async () => {
    const { service, calls } = mockService(created(secret()));
    for (const allowedOrigins of [
      [],
      [""],
      ["x".repeat(513)],
      Array(21).fill("https://a.com"),
      "https://a.com",
      ["http://example.com"],
      ["https://*.com"],
      ["https://example.com/login"],
      ["ftp://example.com"],
      ["https://-a.com"],
      ["https://example.com:70000"],
    ]) {
      await expect(
        service.create({ name: "k", value: "v", allowedOrigins: allowedOrigins as any })
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(calls()).toEqual([]);
  });

  test("addVersion validates against the resolved secret's type", async () => {
    const { service, calls, requestSpy } = mockService((method, path, _body, params) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (path === "/secrets") return listOf(params.search === "github-otp" ? totp() : secret());
      if (method === "POST") return version(2);
      throw new Error(`unexpected ${method} ${path}`);
    });

    await expect(service.addVersion("github-otp", "not a seed!")).rejects.toMatchObject({
      code: "invalid_secret_value",
    });
    expect(calls().filter((call) => call.startsWith("POST"))).toEqual([]);

    await expect(service.addVersion("github-otp", SEED)).resolves.toMatchObject({ version: 2 });
    expect(open(JSON.parse((requestSpy.mock.lastCall![1] as any).body).envelope).header.ctx).toBe(
      TOTP_CONTEXT
    );
    // The same text is a fine plain secret.
    await expect(service.addVersion("provider-key", "not a seed!")).resolves.toMatchObject({
      version: 2,
    });
  });

  test("types this SDK doesn't know get the common value rules only", async () => {
    const { service } = mockService((method, path) => {
      if (path === "/secrets/public-key") return platformPublicKey;
      if (path === "/secrets") return listOf(secret({ type: "future" }));
      return version(2);
    });
    await expect(service.addVersion("provider-key", "anything")).resolves.toMatchObject({
      version: 2,
    });
    await expect(service.addVersion("provider-key", "")).rejects.toThrow(/empty/);
  });

  test("setAllowedOrigins replaces or clears metadata.browser", async () => {
    const withOrigins = secret({
      metadata: { browser: { allowedOrigins: ["https://github.com"] } },
    });
    const { service, calls, requestSpy } = mockService((method, path) => {
      if (path === "/secrets") return listOf(withOrigins);
      if (method === "PATCH") return secret({ metadata: {} });
      throw new Error(`unexpected ${method} ${path}`);
    });

    await service.setAllowedOrigins("provider-key", ["https://github.com", "https://*.github.com"]);
    expect(JSON.parse((requestSpy.mock.calls[1][1] as any).body)).toEqual({
      metadata: { browser: { allowedOrigins: ["https://github.com", "https://*.github.com"] } },
    });
    await expect(service.setAllowedOrigins("provider-key", null)).resolves.toMatchObject({
      metadata: {},
    });
    expect((requestSpy.mock.calls[3][1] as any).body).toBe('{"metadata":{"browser":null}}');
    expect(calls()).toEqual([
      "GET /secrets",
      `PATCH /secrets/${ID}`,
      "GET /secrets",
      `PATCH /secrets/${ID}`,
    ]);

    await expect(service.setAllowedOrigins("provider-key", [])).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(service.update("provider-key", {})).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(calls()).toHaveLength(4);
  });

  test("list filters by type and reads unknown types", async () => {
    const { service, requestSpy } = mockService(() => listOf(secret({ type: "future" })));
    await expect(service.list({ type: "totp" })).resolves.toMatchObject({
      secrets: [{ type: "future" }],
    });
    expect(requestSpy.mock.calls[0][2]).toEqual({
      search: undefined,
      page: undefined,
      limit: undefined,
      type: "totp",
    });
  });
});
