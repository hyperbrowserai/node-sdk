/** A secret value: a UTF-8 string or its raw bytes, used byte-for-byte. */
export type SecretValue = string | Uint8Array;

/**
 * What a secret's value is, fixed at creation:
 * - `"secret"`: an opaque value. It can be a sandbox environment variable,
 *   and once it has allowed origins it can be filled into browser pages.
 * - `"totp"`: a TOTP seed, as base32 or an `otpauth://totp/` URI. Sandboxes
 *   and browser fills get its current one-time code, never the seed.
 * - `"op_token"`: a 1Password service account token, used only as the
 *   `token` of a sandbox's `onePassword` fields. It is never an environment
 *   variable or filled into a page.
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
  /** Bound into every envelope for this secret; the SDK uses it when encrypting. */
  encryptionContext: string;
  /** Null until a value is stored. */
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretVersion {
  version: number;
  kid: string;
  createdAt: string;
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
