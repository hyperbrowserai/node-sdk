import { CustomerKey, unwrapVersion } from "../customer-key";
import { HyperbrowserError, invalidRequest } from "../error";
import {
  CreateVaultParams,
  UpdateVaultParams,
  Vault,
  VaultDeleteResult,
  VaultListParams,
  VaultListResponse,
  VaultReference,
  WrappedVault,
} from "../types/vault";
import { BaseService } from "./base";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Teams hold at most 100 vaults, so this covers every exact-name match. */
const NAME_LOOKUP_LIMIT = 100;
const vaultPath = (id: string): string => `/vaults/${encodeURIComponent(id)}`;

/**
 * Vaults name a set of environment variables whose values come from stored
 * secrets. Pass one as `vault` to a sandbox process
 * or sandbox create, or attach it to a browser session with
 * `credentials: [{ vault }]` and fill its entries by name. A session
 * attaches the vault by reference, so each fill uses its entries as they are
 * then.
 *
 * Entries may be customer-protected secrets. Each sandbox or process use then
 * passes the vault as `unwrap()` returns it, with those entries' envelopes
 * unwrapped with your own key.
 *
 * Methods that take `vault` accept its ID or its exact name. A UUID-shaped
 * argument is tried as an ID first and then as a name.
 */
export class VaultsService extends BaseService {
  async list(params: VaultListParams = {}): Promise<VaultListResponse> {
    const { page, limit, search } = params;
    const response = await this.request<VaultListResponse>("/vaults", undefined, {
      search,
      page,
      limit,
    });
    return { ...response, vaults: response.vaults ?? [] };
  }

  get(vault: string): Promise<Vault> {
    return this.resolve(vault);
  }

  /** Create a vault. Entries name secrets, never values. */
  create(params: CreateVaultParams): Promise<Vault> {
    return this.request<Vault>("/vaults", { method: "POST", body: JSON.stringify(params) });
  }

  /**
   * Change a vault's description or its entries:
   * each entry given replaces that variable, `null` removes it, and entries
   * not given are kept.
   */
  async update(vault: string, params: UpdateVaultParams): Promise<Vault> {
    const { id } = await this.resolve(vault);
    return await this.request<Vault>(vaultPath(id), {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  }

  /** Delete a vault. The secrets its entries name are kept. */
  async delete(vault: string): Promise<VaultDeleteResult> {
    const { id } = await this.resolve(vault);
    return await this.request<VaultDeleteResult>(vaultPath(id), { method: "DELETE" });
  }

  /**
   * The wrapped envelopes of a vault's customer-protected entries, each at
   * the version its entry resolves to now. Most callers want `unwrap()`.
   */
  async getWrapped(vault: string): Promise<WrappedVault> {
    const { id } = await this.resolve(vault);
    return await this.request<WrappedVault>(`${vaultPath(id)}/wrapped`);
  }

  /**
   * Unwrap a vault's customer-protected entries locally with your own key,
   * giving the reference to pass as a sandbox's or process's `vault`. Each
   * envelope is checked against the digest stored with its version. A vault
   * with no customer-protected entries needs none and can be passed by name.
   *
   * `customerKey` may be several keys; each entry uses the one whose `kid`
   * wrapped it. If an entry changes after this, uses fail with
   * `SECRET_VAULT_CHANGED`: unwrap the vault again.
   */
  async unwrap(
    vault: string,
    customerKey: CustomerKey | readonly CustomerKey[]
  ): Promise<VaultReference> {
    const wrapped = await this.getWrapped(vault);
    const unwrapped: VaultReference["unwrapped"] = {};
    for (const [env, entry] of Object.entries(wrapped.entries ?? {})) {
      unwrapped[env] = {
        version: entry.version,
        unwrapped: await unwrapVersion(
          entry,
          customerKey,
          `Entry ${env} of vault ${wrapped.name} (version ${entry.version} of secret ${entry.name})`
        ),
      };
    }
    return { name: wrapped.name, unwrapped };
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
