import { HyperbrowserError, invalidRequest } from "../error";
import { MAX_SECRET_VERSION, SECRET_NAME_PATTERN } from "../sandbox/secret-references";
import {
  credentialValueBytes,
  isPlainObject,
  secretValueBytes,
  SecretsSealer,
} from "../secrets-envelope";
import {
  CreateCredentialParams,
  CreateSecretParams,
  CredentialValue,
  Secret,
  SecretDeleteResult,
  SecretDetail,
  SecretListParams,
  SecretListResponse,
  SecretsPublicKey,
  SecretType,
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

const SECRET_TYPES: readonly SecretType[] = ["secret", "credential"];
/** The most allowed origins a credential can have. */
const MAX_ALLOWED_ORIGINS = 20;

const rethrow = (error: unknown, message: string): never => {
  if (error instanceof HyperbrowserError) {
    throw error;
  }
  throw new HyperbrowserError(message, { cause: error });
};

const checkType = (type: unknown): void => {
  if (type !== undefined && !SECRET_TYPES.includes(type as SecretType)) {
    throw invalidRequest(`Secret type must be one of ${SECRET_TYPES.join(", ")}`);
  }
};

/** Light checks only; the API normalizes origins and reports bad entries. */
const checkAllowedOrigins = (allowedOrigins: unknown): void => {
  if (
    !Array.isArray(allowedOrigins) ||
    allowedOrigins.length < 1 ||
    allowedOrigins.length > MAX_ALLOWED_ORIGINS ||
    allowedOrigins.some((origin) => typeof origin !== "string" || !origin.trim())
  ) {
    throw invalidRequest(
      `allowedOrigins must be 1-${MAX_ALLOWED_ORIGINS} origins such as "https://example.com"`
    );
  }
};

const isBytesOrString = (value: unknown): value is SecretValue =>
  typeof value === "string" || value instanceof Uint8Array;

const wrongShape = (message: string): HyperbrowserError =>
  new HyperbrowserError(message, { code: "invalid_secret_value", retryable: false });

/**
 * Check a value against the platform rules for either shape, so a bad value
 * is reported before anything is fetched or created.
 */
const valueBytes = (value: SecretValue | CredentialValue): Buffer => {
  if (isBytesOrString(value)) {
    return secretValueBytes(value);
  }
  if (isPlainObject(value)) {
    return credentialValueBytes(value as CredentialValue);
  }
  throw wrongShape(
    "Secret value must be a string or bytes, or for a credential an object of field names to strings"
  );
};

/** The plaintext stored for a secret of `type`: raw bytes, or a credential's UTF-8 JSON. */
const versionPlaintext = (type: SecretType, value: SecretValue | CredentialValue): Buffer => {
  if (type === "credential" && isBytesOrString(value)) {
    throw wrongShape(
      "A credential's value must be an object of field names to strings, such as { username, password }"
    );
  }
  if (type !== "credential" && !isBytesOrString(value)) {
    throw wrongShape(
      'A secret\'s value must be a string or bytes; create a type "credential" secret for an object of fields'
    );
  }
  return valueBytes(value);
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
    checkType(params.type);
    try {
      return await this.request<SecretListResponse>("/secrets", undefined, {
        search: params.search,
        page: params.page,
        limit: params.limit,
        type: params.type,
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
    const { name, description, type, metadata, value } = params ?? ({} as CreateSecretParams);
    if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
      throw new HyperbrowserError(
        "Secret name must be 1-128 letters, digits, '_' or '-', starting with a letter or digit"
      );
    }
    checkType(type);
    if (metadata !== undefined && !isPlainObject(metadata)) {
      throw invalidRequest("Secret metadata must be an object");
    }
    const plaintext = value === undefined ? undefined : versionPlaintext(type ?? "secret", value);
    const sealer =
      plaintext === undefined ? undefined : SecretsSealer.fromPublicKey(await this.getPublicKey());

    let secret: Secret;
    try {
      secret = await this.request<Secret>("/secrets", {
        method: "POST",
        body: JSON.stringify({ name, description, type, metadata }),
      });
    } catch (error) {
      return rethrow(error, `Failed to create secret ${name}`);
    }
    if (sealer === undefined || plaintext === undefined) {
      return secret;
    }

    try {
      const version = await this.uploadVersion(secret, sealer, plaintext);
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

  /**
   * Change a secret's description or metadata. Metadata members sent replace
   * the stored ones, `null` removes a member, and members not sent are kept.
   */
  async update(secret: string, params: UpdateSecretParams): Promise<Secret> {
    const { description, metadata } = params ?? ({} as UpdateSecretParams);
    if (description === undefined && metadata === undefined) {
      throw invalidRequest("Pass a description or metadata to update");
    }
    if (metadata !== undefined && !isPlainObject(metadata)) {
      throw invalidRequest("Secret metadata must be an object");
    }
    try {
      const { id } = await this.resolve(secret);
      return await this.request<Secret>(secretPath(id), {
        method: "PATCH",
        body: JSON.stringify({ description, metadata }),
      });
    } catch (error) {
      return rethrow(error, `Failed to update secret ${secret}`);
    }
  }

  /**
   * Encrypt `value` locally and store it as the secret's next version: a
   * `CredentialValue` object for credentials, a string or bytes otherwise.
   */
  async addVersion(secret: string, value: SecretValue | CredentialValue): Promise<SecretVersion> {
    valueBytes(value);
    const sealer = SecretsSealer.fromPublicKey(await this.getPublicKey());
    try {
      const resolved = await this.resolve(secret);
      const plaintext = versionPlaintext(resolved.type ?? "secret", value);
      return await this.uploadVersion(resolved, sealer, plaintext);
    } catch (error) {
      return rethrow(error, `Failed to add a version to secret ${secret}`);
    }
  }

  /**
   * Create a website login credential that browser sessions can fill into
   * pages on `allowedOrigins`, and store its first value. The value is checked
   * and encrypted locally; it is never returned.
   */
  async createCredential(params: CreateCredentialParams): Promise<Secret> {
    const { name, value, allowedOrigins, description } = params ?? ({} as CreateCredentialParams);
    if (value === undefined || value === null) {
      throw wrongShape("A credential needs a value, such as { username, password }");
    }
    checkAllowedOrigins(allowedOrigins);
    return this.create({
      name,
      description,
      type: "credential",
      metadata: { browser: { allowedOrigins } },
      value,
    });
  }

  /**
   * Replace the origins a credential may be filled into, or clear them with
   * `null` (the credential then can't be filled until origins are set again).
   */
  async setAllowedOrigins(secret: string, allowedOrigins: string[] | null): Promise<Secret> {
    if (allowedOrigins !== null) {
      checkAllowedOrigins(allowedOrigins);
    }
    return this.update(secret, {
      metadata: { browser: allowedOrigins === null ? null : { allowedOrigins } },
    });
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

  /** Sealed to the context the API returned for the secret; never one built here. */
  private uploadVersion(secret: Secret, sealer: SecretsSealer, plaintext: Buffer) {
    return this.request<SecretVersion>(`${secretPath(secret.id)}/versions`, {
      method: "POST",
      body: JSON.stringify({ envelope: sealer.seal(secret.encryptionContext, plaintext) }),
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
