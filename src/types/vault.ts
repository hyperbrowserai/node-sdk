/** An entry of a vault: a stored secret. */
export interface VaultEntry {
  /** The secret's name. */
  name: string;
  secretId: string;
  /** A pinned version, or null to follow the secret's latest version. */
  version: number | null;
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

/** A stored secret, following its latest version unless one is pinned. */
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
