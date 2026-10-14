import { HyperbrowserError, invalidRequest } from "../error";
import {
  checkVaultName,
  isSecretEnvName,
  MAX_SECRET_VERSION,
  SECRET_NAME_PATTERN,
} from "../sandbox/secret-references";
import { isPlainObject } from "../secrets-envelope";
import {
  CreateVaultParams,
  UpdateVaultParams,
  Vault,
  VaultDeleteResult,
  VaultListParams,
  VaultListResponse,
} from "../types/vault";
import { BaseService } from "./base";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST_LIMIT = 100;
/** Teams hold at most 100 vaults, so one page of search results covers every match. */
const NAME_LOOKUP_LIMIT = MAX_LIST_LIMIT;
const MAX_VAULT_ENTRIES = 32;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_ONEPASSWORD_PART_LENGTH = 256;
/** The longest op:// reference the platform resolves. */
const MAX_ONEPASSWORD_REFERENCE_BYTES = 512;

// A 1Password name or ID as the platform accepts it in an op:// reference: no
// "/" or "?", no control, format or line-separator characters, and not "."
// or "..". A field may end with a query such as ?attribute=otp.
const ONEPASSWORD_NAME = String.raw`(?!\.{1,2}(?:$|\?))[^/?\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+`;
const ONEPASSWORD_QUERY = String.raw`(?:\?[a-z-]+=[A-Za-z0-9_-]+(?:&[a-z-]+=[A-Za-z0-9_-]+)*)?`;
const ONEPASSWORD_PART_PATTERN = new RegExp(`^${ONEPASSWORD_NAME}$`, "u");
const ONEPASSWORD_FIELD_PATTERN = new RegExp(`^${ONEPASSWORD_NAME}${ONEPASSWORD_QUERY}$`, "u");

const vaultPath = (id: string): string => `/vaults/${encodeURIComponent(id)}`;

const rethrow = (error: unknown, message: string): never => {
  if (error instanceof HyperbrowserError) {
    throw error;
  }
  throw new HyperbrowserError(message, { cause: error });
};

/** Vaults from APIs that predate 1Password vaults have no source. */
const normalizeVault = (vault: Vault): Vault =>
  vault && typeof vault === "object" && vault.source == null
    ? { ...vault, source: { type: "stored" } }
    : vault;

const checkOnePasswordPart = (value: unknown, what: string, pattern = ONEPASSWORD_PART_PATTERN) => {
  if (
    typeof value !== "string" ||
    value.length > MAX_ONEPASSWORD_PART_LENGTH ||
    !pattern.test(value)
  ) {
    throw invalidRequest(
      `${what} must be a 1Password name or ID of 1-${MAX_ONEPASSWORD_PART_LENGTH} characters without '/' or '?'${
        pattern === ONEPASSWORD_FIELD_PATTERN
          ? ", optionally with a query such as ?attribute=otp"
          : ""
      }`
    );
  }
};

const checkDescription = (description: unknown): void => {
  if (
    description !== undefined &&
    (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    throw invalidRequest(
      `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`
    );
  }
};

type EntryKind = "stored" | "1password";

/** Check one entry and return it in the API's shape, with its kind. */
const serializeEntry = (env: string, entry: unknown): { kind: EntryKind; wire: object } => {
  if (!isPlainObject(entry)) {
    throw invalidRequest(
      `Entry ${env} must be { name, version? } for a secret or { item, section?, field } for 1Password`
    );
  }
  if ("item" in entry || "field" in entry || "section" in entry) {
    if ("name" in entry || "version" in entry) {
      throw invalidRequest(`Entry ${env} mixes a secret's name with 1Password fields`);
    }
    const { item, section, field } = entry;
    checkOnePasswordPart(item, `${env}.item`);
    if (section !== undefined) checkOnePasswordPart(section, `${env}.section`);
    checkOnePasswordPart(field, `${env}.field`, ONEPASSWORD_FIELD_PATTERN);
    return {
      kind: "1password",
      wire: section === undefined ? { item, field } : { item, section, field },
    };
  }
  const { name, version } = entry;
  if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
    throw invalidRequest(`Entry ${env} must name a secret: ${String(name)} is not a secret name`);
  }
  if (
    version !== undefined &&
    version !== "latest" &&
    (!Number.isSafeInteger(version) ||
      (version as number) < 1 ||
      (version as number) > MAX_SECRET_VERSION)
  ) {
    throw invalidRequest(
      `Entry ${env} version must be an integer from 1 to ${MAX_SECRET_VERSION} or "latest"`
    );
  }
  return { kind: "stored", wire: version === undefined ? { name } : { name, version } };
};

/** Check entries locally; `null` (remove) is allowed only for updates. */
const serializeEntries = (
  entries: unknown,
  allowRemovals: boolean
): { wire: Record<string, object | null>; kinds: Map<string, EntryKind> } | undefined => {
  if (entries === undefined) {
    return undefined;
  }
  if (!isPlainObject(entries)) {
    throw invalidRequest("entries must map environment variable names to entries");
  }
  const wire: Record<string, object | null> = {};
  const kinds = new Map<string, EntryKind>();
  for (const [env, entry] of Object.entries(entries)) {
    if (!isSecretEnvName(env)) {
      throw invalidRequest(
        `Invalid environment variable name for a vault entry: ${(env as string).slice(0, 64)}`
      );
    }
    if (entry === null && allowRemovals) {
      wire[env] = null;
      continue;
    }
    const { kind, wire: serialized } = serializeEntry(env, entry);
    wire[env] = serialized;
    kinds.set(env, kind);
  }
  return { wire, kinds };
};

const serializeCreate = (params: CreateVaultParams): Record<string, unknown> => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Vault parameters must be an object");
  }
  const { name, description, source, entries } = params;
  checkVaultName(name, "Vault name");
  checkDescription(description);
  let wireSource: Record<string, unknown> | undefined;
  let onePasswordVault: string | undefined;
  if (source !== undefined) {
    if (!isPlainObject(source) || (source.type !== "stored" && source.type !== "1password")) {
      throw invalidRequest(
        'source must be { type: "stored" } or { type: "1password", tokenSecret, vault }'
      );
    }
    if (source.type === "1password") {
      if (typeof source.tokenSecret !== "string" || !SECRET_NAME_PATTERN.test(source.tokenSecret)) {
        throw invalidRequest("source.tokenSecret must be the name of an op_token secret");
      }
      checkOnePasswordPart(source.vault, "source.vault");
      onePasswordVault = source.vault;
      wireSource = { type: "1password", tokenSecret: source.tokenSecret, vault: source.vault };
    } else {
      wireSource = { type: "stored" };
    }
  }
  const serialized = serializeEntries(entries, false);
  if (serialized) {
    if (serialized.kinds.size > MAX_VAULT_ENTRIES) {
      throw invalidRequest(`A vault can hold at most ${MAX_VAULT_ENTRIES} entries`);
    }
    const expected: EntryKind = onePasswordVault === undefined ? "stored" : "1password";
    for (const [env, kind] of serialized.kinds) {
      if (kind !== expected) {
        throw invalidRequest(
          expected === "stored"
            ? `Entry ${env} is a 1Password field, but this vault's values come from stored secrets`
            : `Entry ${env} names a secret, but this vault's values come from 1Password`
        );
      }
      if (onePasswordVault !== undefined) {
        const { item, section, field } = serialized.wire[env] as Record<string, string>;
        const reference = `op://${onePasswordVault}/${item}/${section === undefined ? "" : `${section}/`}${field}`;
        if (Buffer.byteLength(reference, "utf8") > MAX_ONEPASSWORD_REFERENCE_BYTES) {
          throw invalidRequest(
            `Entry ${env}: the 1Password reference is more than ${MAX_ONEPASSWORD_REFERENCE_BYTES} bytes`
          );
        }
      }
    }
  }
  return { name, description, source: wireSource, entries: serialized?.wire };
};

const serializeUpdate = (params: UpdateVaultParams): Record<string, unknown> => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Vault update parameters must be an object");
  }
  const { description, source, entries } = params;
  if (description === undefined && source === undefined && entries === undefined) {
    throw invalidRequest("Pass a description, source or entries to update");
  }
  checkDescription(description);
  let wireSource: Record<string, unknown> | undefined;
  if (source !== undefined) {
    if (!isPlainObject(source) || "type" in source) {
      throw invalidRequest(
        "source must be { tokenSecret?, vault? }: a vault's source type can't change"
      );
    }
    if (source.tokenSecret === undefined && source.vault === undefined) {
      throw invalidRequest("source must name a tokenSecret, a vault, or both");
    }
    if (
      source.tokenSecret !== undefined &&
      (typeof source.tokenSecret !== "string" || !SECRET_NAME_PATTERN.test(source.tokenSecret))
    ) {
      throw invalidRequest("source.tokenSecret must be the name of an op_token secret");
    }
    if (source.vault !== undefined) checkOnePasswordPart(source.vault, "source.vault");
    wireSource = { tokenSecret: source.tokenSecret, vault: source.vault };
  }
  return { description, source: wireSource, entries: serializeEntries(entries, true)?.wire };
};

/**
 * Vaults name a set of environment variables whose values come from stored
 * secrets or from a 1Password vault. Pass one as `vault` to a sandbox process
 * or sandbox create, or attach it to a browser session with
 * `credentials: [{ vault }]` and fill its entries by name.
 *
 * Methods that take `vault` accept its ID or its exact name. A UUID-shaped
 * argument is tried as an ID first and then as a name.
 */
export class VaultsService extends BaseService {
  async list(params: VaultListParams = {}): Promise<VaultListResponse> {
    const { page, limit, search } = params;
    if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) {
      throw invalidRequest("page must be a positive integer");
    }
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT)
    ) {
      throw invalidRequest(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
    }
    try {
      const response = await this.request<VaultListResponse>("/vaults", undefined, {
        search,
        page,
        limit,
      });
      return { ...response, vaults: (response.vaults ?? []).map(normalizeVault) };
    } catch (error) {
      return rethrow(error, "Failed to list vaults");
    }
  }

  async get(vault: string): Promise<Vault> {
    try {
      return await this.resolve(vault);
    } catch (error) {
      return rethrow(error, `Failed to get vault ${vault}`);
    }
  }

  /** Create a vault. Entries name secrets (or 1Password fields), never values. */
  async create(params: CreateVaultParams): Promise<Vault> {
    const body = serializeCreate(params);
    try {
      return normalizeVault(
        await this.request<Vault>("/vaults", { method: "POST", body: JSON.stringify(body) })
      );
    } catch (error) {
      return rethrow(error, `Failed to create vault ${params.name}`);
    }
  }

  /**
   * Change a vault's description, its 1Password settings, or its entries:
   * each entry given replaces that variable, `null` removes it, and entries
   * not given are kept.
   */
  async update(vault: string, params: UpdateVaultParams): Promise<Vault> {
    const body = serializeUpdate(params);
    try {
      const { id } = await this.resolve(vault);
      return normalizeVault(
        await this.request<Vault>(vaultPath(id), { method: "PATCH", body: JSON.stringify(body) })
      );
    } catch (error) {
      return rethrow(error, `Failed to update vault ${vault}`);
    }
  }

  /** Delete a vault. The secrets its entries name are kept. */
  async delete(vault: string): Promise<VaultDeleteResult> {
    try {
      const { id } = await this.resolve(vault);
      return await this.request<VaultDeleteResult>(vaultPath(id), { method: "DELETE" });
    } catch (error) {
      return rethrow(error, `Failed to delete vault ${vault}`);
    }
  }

  private async resolve(key: string): Promise<Vault> {
    if (typeof key !== "string" || !key.trim()) {
      throw invalidRequest("A vault ID or name is required");
    }
    key = key.trim();
    if (UUID_PATTERN.test(key)) {
      try {
        return normalizeVault(await this.request<Vault>(vaultPath(key)));
      } catch (error) {
        if (!(error instanceof HyperbrowserError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }
    const { vaults } = await this.list({ search: key, limit: NAME_LOOKUP_LIMIT });
    const vault = vaults.find((candidate) => candidate.name === key);
    if (!vault) {
      throw new HyperbrowserError(`Vault ${JSON.stringify(key)} not found`, {
        statusCode: 404,
        code: "VAULT_NOT_FOUND",
        service: "control",
      });
    }
    return vault;
  }
}
