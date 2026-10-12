import { HyperbrowserError } from "../error";
import { MAX_SECRET_VERSION, SECRET_NAME_PATTERN } from "../sandbox/secret-references";
import { secretValueBytes, SecretsSealer } from "../secrets-envelope";
import {
  CreateSecretParams,
  Secret,
  SecretDeleteResult,
  SecretDetail,
  SecretListParams,
  SecretListResponse,
  SecretsPublicKey,
  SecretValue,
  SecretVersion,
  SecretVersionDeleteResult,
  UpdateSecretParams,
} from "../types/secret";
import { BaseService } from "./base";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most secrets one list page can hold. */
const MAX_LIST_LIMIT = 100;
/** Teams hold at most 100 secrets, so one page of search results covers every match. */
const NAME_LOOKUP_LIMIT = MAX_LIST_LIMIT;

const secretPath = (id: string): string => `/secrets/${encodeURIComponent(id)}`;

const rethrow = (error: unknown, message: string): never => {
  if (error instanceof HyperbrowserError) {
    throw error;
  }
  throw new HyperbrowserError(message, { cause: error });
};

/**
 * Secrets are encrypted locally to the platform's public key; the API only
 * ever receives envelopes, and values are never returned.
 *
 * Methods that take `secret` accept its ID or its exact name. A UUID-shaped
 * argument is tried as an ID first and then as a name, since names may look
 * like UUIDs.
 */
export class SecretsService extends BaseService {
  /** The key secret values are encrypted to. */
  async getPublicKey(): Promise<SecretsPublicKey> {
    try {
      return await this.request<SecretsPublicKey>("/secrets/public-key");
    } catch (error) {
      return rethrow(error, "Failed to get the secrets public key");
    }
  }

  async list(params: SecretListParams = {}): Promise<SecretListResponse> {
    const { page, limit } = params;
    if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) {
      throw new HyperbrowserError("page must be a positive integer");
    }
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT)
    ) {
      throw new HyperbrowserError(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
    }
    try {
      return await this.request<SecretListResponse>("/secrets", undefined, {
        search: params.search,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      return rethrow(error, "Failed to list secrets");
    }
  }

  /**
   * Create a secret, and store its first version when `value` is given. The
   * value and the platform key are checked before the secret is created, so a
   * bad value never leaves an empty secret behind.
   */
  async create(params: CreateSecretParams): Promise<Secret> {
    const { name, description, value } = params ?? ({} as CreateSecretParams);
    if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
      throw new HyperbrowserError(
        "Secret name must be 1-128 letters, digits, '_' or '-', starting with a letter or digit"
      );
    }
    const sealer = value === undefined ? undefined : await this.prepareSealer(value);

    let secret: Secret;
    try {
      secret = await this.request<Secret>("/secrets", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
    } catch (error) {
      return rethrow(error, `Failed to create secret ${name}`);
    }
    if (sealer === undefined) {
      return secret;
    }

    try {
      const version = await this.uploadVersion(secret, sealer, value as SecretValue);
      return { ...secret, latestVersion: version.version };
    } catch (error) {
      // Retrying create would fail with "name taken"; the value has to be
      // stored on the secret that now exists.
      throw new HyperbrowserError(
        `Secret ${secret.name} (${secret.id}) was created, but storing its value failed: ${
          error instanceof Error ? error.message.replace(/^\[Hyperbrowser\]: /, "") : String(error)
        }. Store it with secrets.addVersion(${JSON.stringify(secret.name)}, value).`,
        {
          code: "secret_value_not_stored",
          retryable: false,
          service: "control",
          details: { secret },
          cause: error,
        }
      );
    }
  }

  /** Metadata and versions; never the value. */
  async get(secret: string): Promise<SecretDetail> {
    try {
      return await this.resolveDetail(secret);
    } catch (error) {
      return rethrow(error, `Failed to get secret ${secret}`);
    }
  }

  async update(secret: string, params: UpdateSecretParams): Promise<Secret> {
    try {
      const { id } = await this.resolve(secret);
      return await this.request<Secret>(secretPath(id), {
        method: "PATCH",
        body: JSON.stringify({ description: params.description }),
      });
    } catch (error) {
      return rethrow(error, `Failed to update secret ${secret}`);
    }
  }

  /** Encrypt `value` locally and store it as the secret's next version. */
  async addVersion(secret: string, value: SecretValue): Promise<SecretVersion> {
    const sealer = await this.prepareSealer(value);
    try {
      return await this.uploadVersion(await this.resolve(secret), sealer, value);
    } catch (error) {
      return rethrow(error, `Failed to add a version to secret ${secret}`);
    }
  }

  /**
   * Permanently delete a secret and its versions. Values already delivered to
   * sandboxes are not revoked.
   */
  async delete(secret: string): Promise<SecretDeleteResult> {
    try {
      const { id } = await this.resolve(secret);
      return await this.request<SecretDeleteResult>(secretPath(id), { method: "DELETE" });
    } catch (error) {
      return rethrow(error, `Failed to delete secret ${secret}`);
    }
  }

  /** Delete one stored version. The latest version cannot be deleted. */
  async deleteVersion(secret: string, version: number): Promise<SecretVersionDeleteResult> {
    if (!Number.isSafeInteger(version) || version < 1 || version > MAX_SECRET_VERSION) {
      throw new HyperbrowserError(`version must be an integer from 1 to ${MAX_SECRET_VERSION}`);
    }
    try {
      const { id } = await this.resolve(secret);
      return await this.request<SecretVersionDeleteResult>(
        `${secretPath(id)}/versions/${version}`,
        {
          method: "DELETE",
        }
      );
    } catch (error) {
      return rethrow(error, `Failed to delete version ${version} of secret ${secret}`);
    }
  }

  private async prepareSealer(value: SecretValue): Promise<SecretsSealer> {
    secretValueBytes(value);
    return SecretsSealer.fromPublicKey(await this.getPublicKey());
  }

  private uploadVersion(secret: Secret, sealer: SecretsSealer, value: SecretValue) {
    return this.request<SecretVersion>(`${secretPath(secret.id)}/versions`, {
      method: "POST",
      body: JSON.stringify({ envelope: sealer.seal(secret.encryptionContext, value) }),
    });
  }

  private async resolve(secret: string): Promise<Secret> {
    return (await this.lookup(secret)).secret;
  }

  private async resolveDetail(secret: string): Promise<SecretDetail> {
    const found = await this.lookup(secret);
    return found.detail ?? (await this.request<SecretDetail>(secretPath(found.secret.id)));
  }

  /** Found by ID, the result already includes the versions. */
  private async lookup(key: string): Promise<{ secret: Secret; detail?: SecretDetail }> {
    if (typeof key !== "string" || !key.trim()) {
      throw new HyperbrowserError("A secret ID or name is required");
    }
    key = key.trim();
    if (UUID_PATTERN.test(key)) {
      try {
        const detail = await this.request<SecretDetail>(secretPath(key));
        return { secret: detail, detail };
      } catch (error) {
        if (!(error instanceof HyperbrowserError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }
    const { secrets } = await this.list({ search: key, limit: NAME_LOOKUP_LIMIT });
    const secret = secrets.find((candidate) => candidate.name === key);
    if (!secret) {
      throw new HyperbrowserError(`Secret ${JSON.stringify(key)} not found`, {
        statusCode: 404,
        code: "SECRET_NOT_FOUND",
        service: "control",
      });
    }
    return { secret };
  }
}
