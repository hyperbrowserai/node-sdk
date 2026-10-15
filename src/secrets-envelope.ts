import crypto from "crypto";
import { HyperbrowserError } from "./error";
import { SecretsPublicKey, SecretValue } from "./types/secret";

/** The largest secret value the platform accepts. */
export const MAX_SECRET_VALUE_BYTES = 32 * 1024;

const MIN_SECRETS_KEY_BITS = 3072;
const SECRETS_KEY_EXPONENT = 65537;

/** @internal A value the platform would refuse. Messages never include the value. */
export const invalidSecretValue = (message: string): HyperbrowserError =>
  new HyperbrowserError(message, { code: "invalid_secret_value", retryable: false });

const base64Url = (data: Buffer | Uint8Array): string => Buffer.from(data).toString("base64url");

/**
 * Apply the platform's value rules locally, so a bad value is reported before
 * anything is created rather than when a sandbox starts.
 */
export const secretValueBytes = (value: SecretValue): Buffer => {
  if (typeof value !== "string" && !(value instanceof Uint8Array)) {
    throw invalidSecretValue("Secret value must be a string or bytes");
  }
  const bytes = Buffer.from(value);
  if (bytes.length === 0) {
    throw invalidSecretValue("Secret value is empty");
  }
  if (bytes.length > MAX_SECRET_VALUE_BYTES) {
    throw invalidSecretValue(`Secret value is more than ${MAX_SECRET_VALUE_BYTES} bytes`);
  }
  if (bytes.includes(0)) {
    throw invalidSecretValue("Secret value must not contain NUL bytes");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidSecretValue("Secret value must be valid UTF-8");
  }
  return bytes;
};

/** A plain object, as opposed to an array, bytes or a class instance. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const minimalBytes = (value: Buffer): Buffer => {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  return value.subarray(start);
};

/** RFC 7638 JWK SHA-256 thumbprint of an RSA key. */
const rsaThumbprint = (n: Buffer, e: Buffer): string =>
  base64Url(
    crypto
      .createHash("sha256")
      .update(`{"e":"${base64Url(e)}","kty":"RSA","n":"${base64Url(n)}"}`)
      .digest()
  );

/** Encrypts values to a verified secrets public key. */
export class SecretsSealer {
  private constructor(
    private readonly kid: string,
    private readonly publicKey: crypto.KeyObject
  ) {}

  /**
   * Check that `key` is a supported RSA key whose ID matches the key itself. A
   * mismatch means a corrupted response or a misconfigured server; where the
   * key comes from rests on TLS to the API.
   */
  static fromPublicKey(key: SecretsPublicKey): SecretsSealer {
    const unsupported = (message: string) =>
      new HyperbrowserError(message, { code: "invalid_secrets_public_key", retryable: false });
    if (key?.alg !== "RSA-OAEP-256" || key.enc !== "A256GCM" || key.jwk?.kty !== "RSA") {
      throw unsupported(`Unsupported secrets public key (${key?.alg}/${key?.enc})`);
    }
    const n = minimalBytes(Buffer.from(key.jwk.n ?? "", "base64url"));
    const e = minimalBytes(Buffer.from(key.jwk.e ?? "", "base64url"));
    if (n.length === 0 || n[0] === 0 || e.length === 0 || e.length > 4) {
      throw unsupported("Secrets public key is malformed");
    }
    // The same policy the server and vm-service enforce for their keys.
    const bits = n.length * 8 - Math.clz32(n[0]) + 24;
    if (bits < MIN_SECRETS_KEY_BITS || e.readUIntBE(0, e.length) !== SECRETS_KEY_EXPONENT) {
      throw unsupported(
        `Secrets public key must be at least ${MIN_SECRETS_KEY_BITS}-bit RSA with exponent ${SECRETS_KEY_EXPONENT}`
      );
    }
    if (rsaThumbprint(n, e) !== key.kid) {
      throw unsupported("Secrets public key does not match its key ID");
    }
    const publicKey = crypto.createPublicKey({
      key: { kty: "RSA", n: base64Url(n), e: base64Url(e) },
      format: "jwk",
    });
    return new SecretsSealer(key.kid, publicKey);
  }

  /**
   * Encrypt `value` as a compact JWE (RSA-OAEP-256 + A256GCM) bound to a
   * secret's encryption context.
   */
  seal(encryptionContext: string, value: SecretValue): string {
    const plaintext = secretValueBytes(value);
    const protectedHeader = base64Url(
      Buffer.from(
        JSON.stringify({
          alg: "RSA-OAEP-256",
          enc: "A256GCM",
          kid: this.kid,
          ctx: encryptionContext,
        })
      )
    );
    const cek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    try {
      const encryptedKey = crypto.publicEncrypt(
        {
          key: this.publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        cek
      );
      const cipher = crypto.createCipheriv("aes-256-gcm", cek, iv);
      cipher.setAAD(Buffer.from(protectedHeader, "ascii"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return [
        protectedHeader,
        base64Url(encryptedKey),
        base64Url(iv),
        base64Url(ciphertext),
        base64Url(cipher.getAuthTag()),
      ].join(".");
    } finally {
      cek.fill(0);
    }
  }
}
