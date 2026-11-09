import crypto from "crypto";
import { HyperbrowserError } from "./error";
import type { WrappedSecretVersion } from "./types/secret";

/**
 * How a customer key wraps an envelope (JWE key management). RSA keys use
 * `RSA-OAEP-256`; EC and X25519/X448 keys use `ECDH-ES+A256KW` unless
 * `ECDH-ES` is chosen. Content is always encrypted with A256GCM.
 */
export type CustomerKeyAlgorithm = "RSA-OAEP-256" | "ECDH-ES" | "ECDH-ES+A256KW";

/**
 * The customer's own key for customer-protected secrets. Each version's
 * envelope, already encrypted to the platform, is wrapped with this key
 * before upload, so nothing the platform stores can be decrypted without it.
 * Each use of the secret passes the envelope unwrapped with this key.
 *
 * `createCustomerKey` builds one from a local key. Implement this interface
 * to keep the private key elsewhere, such as in a KMS or HSM.
 */
export interface CustomerKey {
  /**
   * The key's ID, written as the `kid` of every envelope it wraps: 1-256
   * printable ASCII characters.
   */
  readonly kid: string;
  /**
   * Wrap an inner envelope as a compact JWE (RSA-OAEP-256, ECDH-ES or
   * ECDH-ES+A256KW with A256GCM) whose protected header holds exactly `alg`,
   * `enc`, `kid` and `ctx` (plus `epk`, and optionally `apu` and `apv`, with
   * ECDH-ES), with `ctx` set to `encryptionContext`.
   */
  wrap(innerEnvelope: string, encryptionContext: string): string | Promise<string>;
  /** Decrypt an envelope this key wrapped and return the inner envelope. */
  unwrap(wrappedEnvelope: string): string | Promise<string>;
}

/**
 * A key as `createCustomerKey` takes it: a `KeyObject`, a PEM (or DER
 * `Buffer`) private or public key, or a JWK. A public key can only wrap.
 */
export type CustomerKeyInput = crypto.KeyObject | string | Buffer | crypto.JsonWebKey;

export interface CustomerKeyOptions {
  /** Defaults to the JWK's `kid`, or else the key's RFC 7638 thumbprint. */
  kid?: string;
  /** For EC and X25519/X448 keys; defaults to `ECDH-ES+A256KW`. */
  algorithm?: CustomerKeyAlgorithm;
}

const ENC = "A256GCM";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CEK_BYTES = 32;
/** The server's limits: an inner envelope of 64 KiB, an RSA encrypted key of 256 bytes. */
const MAX_INNER_ENVELOPE_LENGTH = 64 * 1024;
const MIN_RSA_BITS = 2048;
const MAX_KID_LENGTH = 256;
const KID_PATTERN = /^[\x20-\x7E]+$/;
const AES_KW_IV = Buffer.from("A6A6A6A6A6A6A6A6", "hex");
const EC_CURVES: Record<string, string> = {
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521",
};

const keyError = (message: string, code = "invalid_customer_key"): HyperbrowserError =>
  new HyperbrowserError(message, { code, retryable: false });

const unwrapFailed = (message: string): HyperbrowserError =>
  keyError(message, "customer_key_unwrap_failed");

const base64Url = (data: Buffer | Uint8Array): string => Buffer.from(data).toString("base64url");

const decodeSegment = (segment: string, what: string): Buffer => {
  const decoded = /^[A-Za-z0-9_-]*$/.test(segment) ? Buffer.from(segment, "base64url") : null;
  if (!decoded || decoded.toString("base64url") !== segment) {
    throw unwrapFailed(`Wrapped envelope ${what} is not canonical base64url`);
  }
  return decoded;
};

const uint32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};

const lengthPrefixed = (data: Buffer): Buffer => Buffer.concat([uint32(data.length), data]);

/** RFC 7518 §4.6.2 Concat KDF with SHA-256, for one 256-bit key. */
const concatKdf = (sharedSecret: Buffer, algorithmId: string, apu: Buffer, apv: Buffer): Buffer =>
  crypto
    .createHash("sha256")
    .update(
      Buffer.concat([
        uint32(1),
        sharedSecret,
        lengthPrefixed(Buffer.from(algorithmId, "ascii")),
        lengthPrefixed(apu),
        lengthPrefixed(apv),
        uint32(CEK_BYTES * 8),
      ])
    )
    .digest();

/** The members of a public JWK that RFC 7638 thumbprints (and `epk` headers) hold. */
const publicMembers = (jwk: crypto.JsonWebKey): Record<string, string> => {
  switch (jwk.kty) {
    case "RSA":
      return { e: jwk.e as string, kty: "RSA", n: jwk.n as string };
    case "EC":
      return { crv: jwk.crv as string, kty: "EC", x: jwk.x as string, y: jwk.y as string };
    default:
      return { crv: jwk.crv as string, kty: jwk.kty as string, x: jwk.x as string };
  }
};

/** The RFC 7638 SHA-256 thumbprint of a public key. */
const thumbprint = (publicKey: crypto.KeyObject): string =>
  base64Url(
    crypto
      .createHash("sha256")
      .update(JSON.stringify(publicMembers(publicKey.export({ format: "jwk" }))))
      .digest()
  );

const isJwk = (input: unknown): input is crypto.JsonWebKey =>
  !!input &&
  typeof input === "object" &&
  !Buffer.isBuffer(input) &&
  !(input instanceof crypto.KeyObject) &&
  typeof (input as crypto.JsonWebKey).kty === "string";

const loadKeys = (
  input: CustomerKeyInput
): { publicKey: crypto.KeyObject; privateKey?: crypto.KeyObject; jwkKid?: string } => {
  if (input instanceof crypto.KeyObject) {
    if (input.type === "private") {
      return { publicKey: crypto.createPublicKey(input), privateKey: input };
    }
    if (input.type === "public") {
      return { publicKey: input };
    }
    throw keyError("A customer key must be an asymmetric key, not a secret key");
  }
  if (isJwk(input)) {
    const jwkKid = typeof input.kid === "string" ? input.kid : undefined;
    try {
      if (typeof input.d === "string") {
        const privateKey = crypto.createPrivateKey({ key: input, format: "jwk" });
        return { publicKey: crypto.createPublicKey(privateKey), privateKey, jwkKid };
      }
      return { publicKey: crypto.createPublicKey({ key: input, format: "jwk" }), jwkKid };
    } catch (cause) {
      throw new HyperbrowserError("The customer key JWK could not be read", {
        code: "invalid_customer_key",
        cause,
      });
    }
  }
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    try {
      const privateKey = crypto.createPrivateKey(input);
      return { publicKey: crypto.createPublicKey(privateKey), privateKey };
    } catch {
      try {
        return { publicKey: crypto.createPublicKey(input) };
      } catch (cause) {
        throw new HyperbrowserError("The customer key is not a PEM or DER key", {
          code: "invalid_customer_key",
          cause,
        });
      }
    }
  }
  throw keyError("A customer key must be a KeyObject, a PEM or DER key, or a JWK");
};

/** Throws unless `kid` is a key ID the API stores: 1-256 printable ASCII characters. */
export const assertCustomerKeyId = (kid: unknown): string => {
  if (typeof kid !== "string" || kid.length > MAX_KID_LENGTH || !KID_PATTERN.test(kid)) {
    throw keyError(`A customer key's kid must be 1-${MAX_KID_LENGTH} printable ASCII characters`);
  }
  return kid;
};

type KeyKind = { type: "rsa" } | { type: "ec"; curve: string } | { type: "x25519" | "x448" };

const keyKind = (publicKey: crypto.KeyObject): KeyKind => {
  const type = publicKey.asymmetricKeyType;
  if (type === "rsa") {
    const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < MIN_RSA_BITS) {
      throw keyError(`RSA customer keys must be at least ${MIN_RSA_BITS} bits`);
    }
    return { type };
  }
  if (type === "ec") {
    const curve = publicKey.asymmetricKeyDetails?.namedCurve ?? "";
    if (!EC_CURVES[curve]) {
      throw keyError("EC customer keys must be on P-256, P-384 or P-521");
    }
    return { type, curve };
  }
  if (type === "x25519" || type === "x448") {
    return { type };
  }
  throw keyError("A customer key must be RSA, EC (P-256, P-384, P-521), X25519 or X448");
};

/** A customer key held in this process. */
class LocalCustomerKey implements CustomerKey {
  readonly kid: string;
  private readonly kind: KeyKind;
  private readonly algorithm: CustomerKeyAlgorithm;

  constructor(
    private readonly publicKey: crypto.KeyObject,
    private readonly privateKey: crypto.KeyObject | undefined,
    options: CustomerKeyOptions & { jwkKid?: string }
  ) {
    this.kind = keyKind(publicKey);
    const algorithm =
      options.algorithm ?? (this.kind.type === "rsa" ? "RSA-OAEP-256" : "ECDH-ES+A256KW");
    if ((algorithm === "RSA-OAEP-256") !== (this.kind.type === "rsa")) {
      throw keyError(
        this.kind.type === "rsa"
          ? "RSA customer keys wrap with RSA-OAEP-256"
          : "EC and X25519/X448 customer keys wrap with ECDH-ES or ECDH-ES+A256KW"
      );
    }
    if (!["RSA-OAEP-256", "ECDH-ES", "ECDH-ES+A256KW"].includes(algorithm)) {
      throw keyError(`Unsupported customer key algorithm ${String(algorithm)}`);
    }
    this.algorithm = algorithm;
    this.kid = assertCustomerKeyId(options.kid ?? options.jwkKid ?? thumbprint(publicKey));
  }

  /** Whether this key can unwrap, that is, holds its private key. */
  get canUnwrap(): boolean {
    return this.privateKey !== undefined;
  }

  wrap(innerEnvelope: string, encryptionContext: string): string {
    if (typeof innerEnvelope !== "string" || innerEnvelope.length === 0) {
      throw keyError("The envelope to wrap must be a non-empty string", "invalid_request");
    }
    if (innerEnvelope.length > MAX_INNER_ENVELOPE_LENGTH) {
      throw keyError("The envelope to wrap is larger than 64 KiB", "invalid_request");
    }
    if (typeof encryptionContext !== "string" || encryptionContext.length === 0) {
      throw keyError("An encryption context is required to wrap an envelope", "invalid_request");
    }
    const header: Record<string, unknown> = {
      alg: this.algorithm,
      enc: ENC,
      kid: this.kid,
      ctx: encryptionContext,
    };
    let cek: Buffer;
    let encryptedKey = Buffer.alloc(0);
    if (this.kind.type === "rsa") {
      cek = crypto.randomBytes(CEK_BYTES);
      encryptedKey = crypto.publicEncrypt(
        {
          key: this.publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        cek
      );
    } else {
      const ephemeral =
        this.kind.type === "ec"
          ? crypto.generateKeyPairSync("ec", { namedCurve: this.kind.curve })
          : crypto.generateKeyPairSync(this.kind.type as "x25519");
      header.epk = publicMembers(ephemeral.publicKey.export({ format: "jwk" }));
      const shared = crypto.diffieHellman({
        privateKey: ephemeral.privateKey,
        publicKey: this.publicKey,
      });
      const derived = concatKdf(
        shared,
        this.algorithm === "ECDH-ES" ? ENC : this.algorithm,
        Buffer.alloc(0),
        Buffer.alloc(0)
      );
      shared.fill(0);
      if (this.algorithm === "ECDH-ES") {
        cek = derived;
      } else {
        cek = crypto.randomBytes(CEK_BYTES);
        const wrapper = crypto.createCipheriv("id-aes256-wrap", derived, AES_KW_IV);
        encryptedKey = Buffer.concat([wrapper.update(cek), wrapper.final()]);
        derived.fill(0);
      }
    }
    try {
      const protectedHeader = base64Url(Buffer.from(JSON.stringify(header), "utf8"));
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv("aes-256-gcm", cek, iv);
      cipher.setAAD(Buffer.from(protectedHeader, "ascii"));
      const ciphertext = Buffer.concat([cipher.update(innerEnvelope, "utf8"), cipher.final()]);
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

  unwrap(wrappedEnvelope: string): string {
    if (!this.privateKey) {
      throw keyError(
        `Customer key ${this.kid} has no private key, so it can wrap but not unwrap`,
        "customer_key_private_key_required"
      );
    }
    if (typeof wrappedEnvelope !== "string") {
      throw unwrapFailed("The wrapped envelope must be a string");
    }
    const segments = wrappedEnvelope.split(".");
    if (segments.length !== 5) {
      throw unwrapFailed("The wrapped envelope must have five segments");
    }
    const [headerSegment, keySegment, ivSegment, ciphertextSegment, tagSegment] = segments;
    let header: Record<string, unknown>;
    try {
      header = JSON.parse(decodeSegment(headerSegment, "header").toString("utf8"));
    } catch (error) {
      if (error instanceof HyperbrowserError) throw error;
      throw unwrapFailed("The wrapped envelope header is not JSON");
    }
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw unwrapFailed("The wrapped envelope header is not a JSON object");
    }
    if (header.kid !== this.kid) {
      throw keyError(
        `The envelope was wrapped with key ${JSON.stringify(header.kid)}, not ${JSON.stringify(this.kid)}`,
        "customer_key_mismatch"
      );
    }
    if (header.enc !== ENC) {
      throw unwrapFailed(`Unsupported wrapped envelope encryption ${String(header.enc)}`);
    }
    const alg = header.alg;
    const encryptedKey = decodeSegment(keySegment, "encrypted key");
    const iv = decodeSegment(ivSegment, "IV");
    const ciphertext = decodeSegment(ciphertextSegment, "ciphertext");
    const tag = decodeSegment(tagSegment, "tag");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw unwrapFailed("The wrapped envelope IV or tag has the wrong length");
    }

    let cek: Buffer;
    try {
      if (alg === "RSA-OAEP-256" && this.kind.type === "rsa") {
        cek = crypto.privateDecrypt(
          {
            key: this.privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
          },
          encryptedKey
        );
      } else if ((alg === "ECDH-ES" || alg === "ECDH-ES+A256KW") && this.kind.type !== "rsa") {
        const optional = (name: "apu" | "apv") =>
          header[name] === undefined ? Buffer.alloc(0) : decodeSegment(String(header[name]), name);
        const epk = crypto.createPublicKey({
          key: header.epk as crypto.JsonWebKey,
          format: "jwk",
        });
        const shared = crypto.diffieHellman({ privateKey: this.privateKey, publicKey: epk });
        const derived = concatKdf(
          shared,
          alg === "ECDH-ES" ? ENC : alg,
          optional("apu"),
          optional("apv")
        );
        shared.fill(0);
        if (alg === "ECDH-ES") {
          cek = derived;
        } else {
          const unwrapper = crypto.createDecipheriv("id-aes256-wrap", derived, AES_KW_IV);
          cek = Buffer.concat([unwrapper.update(encryptedKey), unwrapper.final()]);
          derived.fill(0);
        }
      } else {
        throw unwrapFailed(
          `Customer key ${this.kid} can't unwrap an envelope wrapped with ${String(alg)}`
        );
      }
    } catch (error) {
      if (error instanceof HyperbrowserError) throw error;
      throw new HyperbrowserError("The wrapped envelope's key could not be decrypted", {
        code: "customer_key_unwrap_failed",
        cause: error,
      });
    }
    try {
      if (cek.length !== CEK_BYTES) {
        throw unwrapFailed("The wrapped envelope's content key has the wrong length");
      }
      const decipher = crypto.createDecipheriv("aes-256-gcm", cek, iv);
      decipher.setAAD(Buffer.from(headerSegment, "ascii"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof HyperbrowserError) throw error;
      throw new HyperbrowserError("The wrapped envelope could not be decrypted", {
        code: "customer_key_unwrap_failed",
        cause: error,
      });
    } finally {
      cek.fill(0);
    }
  }
}

/**
 * A customer key from a local key: RSA (at least 2048 bits), EC (P-256,
 * P-384 or P-521), X25519 or X448. With only the public key it can wrap
 * (upload versions) but not unwrap (use them).
 *
 * The key ID defaults to the JWK's `kid`, or else the RFC 7638 thumbprint of
 * the public key, so the same key always gets the same ID.
 */
export const createCustomerKey = (
  key: CustomerKeyInput,
  options: CustomerKeyOptions = {}
): CustomerKey & { readonly canUnwrap: boolean } => {
  const { publicKey, privateKey, jwkKid } = loadKeys(key);
  return new LocalCustomerKey(publicKey, privateKey, { ...options, jwkKid });
};

/**
 * Identifies an inner envelope as the API does: the unpadded base64url
 * SHA-256 of its compact form.
 */
export const secretEnvelopeDigest = (envelope: string): string =>
  crypto.createHash("sha256").update(envelope, "utf8").digest("base64url");

/** @internal Checks that `key` looks like a CustomerKey before anything is sent. */
export const assertCustomerKey = (key: unknown, what = "customerKey"): CustomerKey => {
  const candidate = key as CustomerKey | null | undefined;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.wrap !== "function" ||
    typeof candidate.unwrap !== "function"
  ) {
    throw new HyperbrowserError(
      `${what} must be a customer key, such as one from createCustomerKey()`,
      { code: "invalid_request", retryable: false }
    );
  }
  assertCustomerKeyId(candidate.kid);
  return candidate;
};

/**
 * @internal Unwrap a wrapped version with the key among `keys` that wrapped
 * it, and check the result is the inner envelope the version holds.
 */
export const unwrapVersion = async (
  wrapped: Pick<WrappedSecretVersion, "outerKid" | "innerDigest" | "envelope">,
  keys: CustomerKey | readonly CustomerKey[],
  label: string
): Promise<string> => {
  const key = customerKeyFor(keys, wrapped.outerKid, label);
  const inner = await key.unwrap(wrapped.envelope);
  if (typeof inner !== "string" || secretEnvelopeDigest(inner) !== wrapped.innerDigest) {
    throw new HyperbrowserError(
      `${label} unwrapped to an envelope that doesn't match its innerDigest; it may have been uploaded with the wrong digest`,
      { code: "customer_key_unwrap_failed", retryable: false }
    );
  }
  return inner;
};

/** @internal The key among `keys` that wrapped an envelope with this `kid`. */
export const customerKeyFor = (
  keys: CustomerKey | readonly CustomerKey[],
  kid: string,
  label: string
): CustomerKey => {
  const list = (Array.isArray(keys) ? keys : [keys]) as readonly CustomerKey[];
  if (list.length === 0) {
    throw new HyperbrowserError("Pass at least one customer key", {
      code: "invalid_request",
      retryable: false,
    });
  }
  list.forEach((key, index) => assertCustomerKey(key, `customerKey[${index}]`));
  const key = list.find((candidate) => candidate.kid === kid);
  if (!key) {
    throw new HyperbrowserError(
      `${label} was wrapped with customer key ${JSON.stringify(kid)}, which none of the keys given has`,
      { code: "customer_key_mismatch", retryable: false }
    );
  }
  return key;
};
