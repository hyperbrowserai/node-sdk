import type { CustomerKey } from "../customer-key";

/** A secret value: a UTF-8 string or its raw bytes, used byte-for-byte. */
export type SecretValue = string | Uint8Array;

/**
 * Fixed at creation. `"customer"` secrets are also wrapped with your own
 * `CustomerKey`, and each use passes what `secrets.unwrap()` or
 * `vaults.unwrap()` returns; they can't be filled into browser pages.
 */
export type SecretProtection = "platform" | "customer";

/**
 * What a secret's value is, fixed at creation:
 * - `"secret"`: an opaque value. It can be a sandbox environment variable,
 *   and once it has allowed origins it can be filled into browser pages.
 * - `"totp"`: a TOTP seed, as base32 or an `otpauth://totp/` URI. Sandboxes
 *   and browser fills get its current one-time code, never the seed.
 * - `"op_token"`: a 1Password service account token, used only as the
 *   `token` of a sandbox's or a browser fill's `onePassword` fields. It is
 *   never an environment variable or filled into a page itself.
 */
export type SecretType = "secret" | "totp" | "op_token";

export interface SecretBrowserMetadata {
  /**
   * Origins the secret may be filled into, as `scheme://host[:port]`. A
   * leading `*.` matches any subdomain (not the domain itself).
   */
  allowedOrigins: string[];
}

/** `{}` until allowed origins are set. */
export interface SecretMetadata {
  browser?: SecretBrowserMetadata;
  [member: string]: unknown;
}

export interface SecretsPublicKeyJwk {
  kty: string;
  n: string;
  e: string;
}

/** The platform key that secret values are encrypted to before upload. */
export interface SecretsPublicKey {
  kid: string;
  alg: string;
  enc: string;
  jwk: SecretsPublicKeyJwk;
}

export interface Secret {
  id: string;
  name: string;
  description: string;
  /**
   * A `SecretType`. Typed as a string so secrets of types added later are
   * still read.
   */
  type: string;
  metadata: SecretMetadata;
  /**
   * A `SecretProtection`, typed as a string for values added later. Absent
   * from API versions before customer protection, which means `"platform"`.
   */
  protection?: string;
  /** Bound into every envelope for this secret; the SDK uses it when encrypting. */
  encryptionContext: string;
  /** Null until a value is stored. */
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretVersion {
  version: number;
  /** The platform key the (inner) envelope was encrypted to. */
  kid: string;
  /** The customer key that wrapped this version; customer-protected secrets only. */
  outerKid?: string;
  /**
   * When this version stops working because its platform key is retired.
   * After then, uses fail with `SECRET_KEY_RETIRED`; add a new version and use
   * that instead.
   */
  retiresAt?: string | null;
  createdAt: string;
}

/** A customer-protected version as the API stores it, for the customer to unwrap. */
export interface WrappedSecretVersion {
  version: number;
  /** The platform key the inner envelope is encrypted to. */
  kid: string;
  retiresAt: string | null;
  /** The customer key that wrapped it. */
  outerKid: string;
  /** Unpadded base64url SHA-256 of the inner envelope. */
  innerDigest: string;
  /** The outer envelope, which only the customer key can open. */
  envelope: string;
}

/**
 * A customer-protected secret ready to use: pass it as a sandbox or process
 * `secrets` entry, or as a 1Password `token`. It is the version's inner
 * envelope, which only the platform can open, but anyone holding it can use
 * that version, so treat it like the secret itself.
 */
export interface UnwrappedSecretReference {
  name: string;
  version: number;
  unwrapped: string;
}

export interface UnwrapSecretOptions {
  /** Defaults to the latest version. */
  version?: number | "latest";
}

export interface AddSecretVersionOptions {
  /** Required for customer-protected secrets, which it wraps the value with; not allowed otherwise. */
  customerKey?: CustomerKey;
}

/** A new outer envelope for a version, wrapping the same inner envelope. */
export interface ReplaceSecretVersionWrappingParams {
  envelope: string;
  /** Must match the version's `innerDigest`: rewrapping can't change the value. */
  innerDigest: string;
}

export interface RewrapSecretParams {
  /** The key (or keys, picked by `kid`) the versions are wrapped with now. */
  from: CustomerKey | readonly CustomerKey[];
  /** The key to wrap them with instead. */
  to: CustomerKey;
  /**
   * Versions to rewrap. Defaults to every version not already wrapped with
   * `to`, so an interrupted rotation can be run again.
   */
  versions?: number[];
}

export interface SecretDetail extends Secret {
  versions: SecretVersion[];
}

export interface CreateSecretParams {
  /** 1-128 letters, digits, '_' or '-', starting with a letter or digit. */
  name: string;
  description?: string;
  /** Defaults to `"secret"`. */
  type?: SecretType;
  /**
   * The first version's value. It is checked against the type's rules and
   * the platform key is checked before the secret is created; then it is
   * encrypted locally and uploaded.
   *
   * - `"secret"`: any string or bytes.
   * - `"totp"`: a base32 seed (spaces, hyphens, lowercase and trailing `=`
   *   padding are fine) or an `otpauth://totp/...?secret=...` URI, optionally
   *   with `algorithm` (SHA1, SHA256 or SHA512), `digits` (6 or 8) and
   *   `period` (1-300). A seed whose length can't be whole base32 (1, 3 or 6
   *   characters past a multiple of 8) is refused as incompletely copied.
   *   Seeds under 10 bytes (16 characters) are accepted but unusually short.
   * - `"op_token"`: a 1Password service account token. These start with
   *   `ops_`, but other values are not refused.
   */
  value?: SecretValue;
  /**
   * Origins the secret may be filled into in browser sessions, such as
   * `["https://github.com"]`; 1-20 entries. Not for `"op_token"` secrets.
   */
  allowedOrigins?: string[];
  /**
   * Defaults to `"customer"` when `customerKey` is given and `"platform"`
   * otherwise. Fixed at creation.
   */
  protection?: SecretProtection;
  /**
   * The customer's own key, which wraps every version of a
   * customer-protected secret. Required to store `value` in one.
   */
  customerKey?: CustomerKey;
}

/**
 * Metadata members sent replace the stored ones, `null` removes a member, and
 * members not sent are kept.
 */
export interface UpdateSecretMetadata {
  browser?: SecretBrowserMetadata | null;
}

/** At least one field. */
export interface UpdateSecretParams {
  description?: string;
  metadata?: UpdateSecretMetadata;
}

export interface SecretListParams {
  search?: string;
  /** Only secrets of this type. */
  type?: SecretType;
  page?: number;
  /** At most 100. */
  limit?: number;
}

export interface SecretListResponse {
  secrets: Secret[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface SecretDeleteResult {
  deleted: boolean;
  id: string;
  name: string;
}

export interface SecretVersionDeleteResult {
  deleted: boolean;
  version: number;
}
