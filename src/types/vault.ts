import type { WrappedSecretVersion } from "./secret";

/** An entry of a vault: a stored secret. */
export interface VaultEntry {
  /** The secret's name. */
  name: string;
  secretId: string;
  /** A pinned version, or null to follow the secret's latest version. */
  version: number | null;
  /**
   * The secret's `SecretProtection`. With `"customer"`, each use of the vault
   * passes this entry's unwrapped envelope (see `vaults.unwrap()`). Absent
   * from API versions before customer protection.
   */
  protection?: string;
}

/** A customer-protected entry's wrapped envelope, at the version the entry resolves to now. */
export interface WrappedVaultEntry extends WrappedSecretVersion {
  /** The secret's name. */
  name: string;
  secretId: string;
}

export interface WrappedVault {
  id: string;
  name: string;
  /** Customer-protected entries only, by environment variable. */
  entries: Record<string, WrappedVaultEntry>;
}

/** The envelope the customer unwrapped for one entry, and the version it is from. */
export interface VaultUnwrappedEntry {
  version: number;
  unwrapped: string;
}

/**
 * A vault with the envelopes of its customer-protected entries, as
 * `vaults.unwrap()` returns it: pass it as a sandbox's or process's `vault`.
 * The envelopes match the entries as they were unwrapped; if an entry changes
 * since, uses fail with `SECRET_VAULT_CHANGED` and the vault must be
 * unwrapped again. Anyone holding it can use those versions.
 */
export interface VaultReference {
  name: string;
  /** Environment variable name to unwrapped envelope; at most 32. */
  unwrapped: Record<string, VaultUnwrappedEntry>;
}

/** Named environment variables whose values come from stored secrets. A vault holds no values itself. */
export interface Vault {
  id: string;
  name: string;
  description: string;
  /** Environment variable name to entry. */
  entries: Record<string, VaultEntry>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A stored secret, following its latest version unless one is pinned. It may
 * be customer-protected; entries never hold unwrapped envelopes.
 */
export interface VaultEntryParams {
  /** The secret's name. */
  name: string;
  version?: number | "latest";
}

export interface CreateVaultParams {
  /** 1-128 letters, digits, '_' or '-', starting with a letter or digit. */
  name: string;
  description?: string;
  /** Environment variable name to secret, at most 32. */
  entries?: Record<string, VaultEntryParams>;
}

/** At least one field. */
export interface UpdateVaultParams {
  description?: string;
  /** Each entry given replaces that variable; `null` removes it. Others are kept. */
  entries?: Record<string, VaultEntryParams | null>;
}

export interface VaultListParams {
  /** Vaults whose name contains this. */
  search?: string;
  page?: number;
  /** At most 100. */
  limit?: number;
}

export interface VaultListResponse {
  vaults: Vault[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface VaultDeleteResult {
  deleted: boolean;
  id: string;
  name: string;
}
