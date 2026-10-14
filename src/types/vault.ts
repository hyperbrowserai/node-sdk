/** An entry of a stored vault: a stored secret. */
export interface VaultSecretEntry {
  /** The secret's name. */
  name: string;
  secretId: string;
  /** A pinned version, or null to follow the secret's latest version. */
  version: number | null;
}

/** An entry of a 1Password vault: a field of a 1Password item. */
export interface VaultOnePasswordEntry {
  /** The item's name or ID. */
  item: string;
  /** The section's name or ID, when the field is in one. */
  section?: string;
  /** The field's name or ID, optionally with a query such as `?attribute=otp`. */
  field: string;
  /** The reference the field is read from: `op://<vault>/<item>/[<section>/]<field>`. */
  reference: string;
}

export type VaultEntry = VaultSecretEntry | VaultOnePasswordEntry;

/** Values come from stored secrets. */
export interface VaultStoredSource {
  type: "stored";
}

/** Values are read from a 1Password vault when a sandbox process starts. */
export interface VaultOnePasswordSource {
  type: "1password";
  /** The `op_token` secret that signs in to 1Password. */
  tokenSecret: { name: string; secretId: string };
  /** The 1Password vault's name or ID. */
  vault: string;
}

/** A source of a type this SDK doesn't know yet, passed through as sent. */
export interface VaultOtherSource {
  type: string;
  [member: string]: unknown;
}

export type VaultSource = VaultStoredSource | VaultOnePasswordSource | VaultOtherSource;

/**
 * Named environment variables whose values come from stored secrets or a
 * 1Password vault. A vault holds no values itself.
 */
export interface Vault {
  id: string;
  name: string;
  description: string;
  /** Where values come from. APIs that predate sources omit it; it is then `{ type: "stored" }`. */
  source: VaultSource;
  /** Environment variable name to entry. */
  entries: Record<string, VaultEntry>;
  createdAt: string;
  updatedAt: string;
}

/** A stored secret for a stored vault, following its latest version unless one is pinned. */
export interface VaultSecretEntryParams {
  /** The secret's name. */
  name: string;
  version?: number | "latest";
}

/**
 * A field of a 1Password item for a 1Password vault. Names and IDs are 1-256
 * characters without '/' or '?', and not "." or "..". The field may end
 * with a query such as `?attribute=otp`.
 */
export interface VaultOnePasswordEntryParams {
  item: string;
  section?: string;
  field: string;
}

export type VaultEntryParams = VaultSecretEntryParams | VaultOnePasswordEntryParams;

export type VaultSourceParams =
  | { type: "stored" }
  | {
      type: "1password";
      /** The name of an `op_token` secret holding the service account token. */
      tokenSecret: string;
      /** The 1Password vault's name or ID. */
      vault: string;
    };

export interface CreateVaultParams {
  /** 1-128 letters, digits, '_' or '-', starting with a letter or digit. */
  name: string;
  description?: string;
  /** Defaults to `{ type: "stored" }`. Fixed at creation. */
  source?: VaultSourceParams;
  /**
   * Environment variable name to entry, at most 32: secrets for a stored
   * vault, 1Password fields for a 1Password vault.
   */
  entries?: Record<string, VaultEntryParams>;
}

/** At least one field. */
export interface UpdateVaultParams {
  description?: string;
  /** A 1Password vault's settings. The source type can't change. */
  source?: { tokenSecret?: string; vault?: string };
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
