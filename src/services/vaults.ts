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

const vaultPath = (id: string): string => `/vaults/${encodeURIComponent(id)}`;

const rethrow = (error: unknown, message: string): never => {
  if (error instanceof HyperbrowserError) {
    throw error;
  }
  throw new HyperbrowserError(message, { cause: error });
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

/** Check one entry and return it in the API's shape. */
const serializeEntry = (env: string, entry: unknown): object => {
  if (!isPlainObject(entry)) {
    throw invalidRequest(`Entry ${env} must be { name, version? }`);
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
  return version === undefined ? { name } : { name, version };
};

/** Check entries locally; `null` (remove) is allowed only for updates. */
const serializeEntries = (
  entries: unknown,
  allowRemovals: boolean
): Record<string, object | null> | undefined => {
  if (entries === undefined) {
    return undefined;
  }
  if (!isPlainObject(entries)) {
    throw invalidRequest("entries must map environment variable names to entries");
  }
  const wire: Record<string, object | null> = {};
  for (const [env, entry] of Object.entries(entries)) {
    if (!isSecretEnvName(env)) {
      throw invalidRequest(
        `Invalid environment variable name for a vault entry: ${(env as string).slice(0, 64)}`
      );
    }
    wire[env] = entry === null && allowRemovals ? null : serializeEntry(env, entry);
  }
  return wire;
};

const serializeCreate = (params: CreateVaultParams): Record<string, unknown> => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Vault parameters must be an object");
  }
  const { name, description, entries } = params;
  checkVaultName(name, "Vault name");
  checkDescription(description);
  const wire = serializeEntries(entries, false);
  if (wire && Object.keys(wire).length > MAX_VAULT_ENTRIES) {
    throw invalidRequest(`A vault can hold at most ${MAX_VAULT_ENTRIES} entries`);
  }
  return { name, description, entries: wire };
};

const serializeUpdate = (params: UpdateVaultParams): Record<string, unknown> => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Vault update parameters must be an object");
  }
  const { description, entries } = params;
  if (description === undefined && entries === undefined) {
    throw invalidRequest("Pass a description or entries to update");
  }
  checkDescription(description);
  return { description, entries: serializeEntries(entries, true) };
};

/**
 * Vaults name a set of environment variables whose values come from stored
 * secrets. Pass one as `vault` to a sandbox process
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
      return { ...response, vaults: response.vaults ?? [] };
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

  /** Create a vault. Entries name secrets, never values. */
  async create(params: CreateVaultParams): Promise<Vault> {
    const body = serializeCreate(params);
    try {
      return await this.request<Vault>("/vaults", { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      return rethrow(error, `Failed to create vault ${params.name}`);
    }
  }

  /**
   * Change a vault's description or its entries:
   * each entry given replaces that variable, `null` removes it, and entries
   * not given are kept.
   */
  async update(vault: string, params: UpdateVaultParams): Promise<Vault> {
    const body = serializeUpdate(params);
    try {
      const { id } = await this.resolve(vault);
      return await this.request<Vault>(vaultPath(id), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
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
        return await this.request<Vault>(vaultPath(key));
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
