/** A secret value: a UTF-8 string or its raw bytes, used byte-for-byte. */
export type SecretValue = string | Uint8Array;

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
  /**
   * The first version's value. It is validated and the platform key is checked
   * before the secret is created, then encrypted locally and uploaded.
   */
  value?: SecretValue;
}

export interface UpdateSecretParams {
  description: string;
}

export interface SecretListParams {
  search?: string;
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
