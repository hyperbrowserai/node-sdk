/** A secret value: a UTF-8 string or its raw bytes, used byte-for-byte. */
export type SecretValue = string | Uint8Array;

/**
 * `"secret"` values are delivered to sandboxes; `"credential"` values are
 * website logins filled into browser sessions. Fixed at creation.
 */
export type SecretType = "secret" | "credential";

/**
 * A credential's value: field names (such as `username` and `password`) to
 * non-empty strings. Keys match `^[a-zA-Z0-9_.-]{1,64}$`.
 */
export type CredentialValue = Record<string, string>;

export interface SecretBrowserMetadata {
  /**
   * Origins a credential may be filled into, as `scheme://host[:port]`. A
   * leading `*.` matches any subdomain (not the domain itself).
   */
  allowedOrigins: string[];
}

/** Plain secrets always have `{}`. */
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
  type: SecretType;
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
  /** For credentials, `{ browser: { allowedOrigins } }`. */
  metadata?: SecretMetadata;
  /**
   * The first version's value: a `CredentialValue` object for credentials, a
   * string or bytes otherwise. It is validated and the platform key is checked
   * before the secret is created, then encrypted locally and uploaded.
   */
  value?: SecretValue | CredentialValue;
}

export interface CreateCredentialParams {
  /** 1-128 letters, digits, '_' or '-', starting with a letter or digit. */
  name: string;
  /** Field names to values, such as `{ username, password }`. */
  value: CredentialValue;
  /** Origins the credential may be filled into, such as `["https://github.com"]`. */
  allowedOrigins: string[];
  description?: string;
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
