import {
  assertCustomerKey,
  assertCustomerKeys,
  CustomerKey,
  secretEnvelopeDigest,
  unwrapVersion,
  wrapEnvelope,
} from "../customer-key";
import { HyperbrowserError, invalidRequest } from "../error";
import { MAX_SECRET_VERSION, SECRET_NAME_PATTERN } from "../sandbox/secret-references";
import { secretPlaintext } from "../secret-values";
import { isPlainObject, secretValueBytes, SecretsSealer } from "../secrets-envelope";
import {
  AddSecretVersionOptions,
  CreateSecretParams,
  ReplaceSecretVersionWrappingParams,
  RewrapSecretParams,
  Secret,
  SecretDeleteResult,
  SecretDetail,
  SecretListParams,
  SecretListResponse,
  SecretsPublicKey,
  SecretValue,
  SecretVersion,
  SecretVersionDeleteResult,
  UnwrappedSecretReference,
  UnwrapSecretOptions,
  UpdateSecretParams,
  WrappedSecretVersion,
} from "../types/secret";
import { BaseService } from "./base";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most secrets one list page can hold. */
const MAX_LIST_LIMIT = 100;
/** Teams hold at most 100 secrets, so one page of search results covers every match. */
const NAME_LOOKUP_LIMIT = MAX_LIST_LIMIT;

const secretPath = (id: string): string => `/secrets/${encodeURIComponent(id)}`;

const isCustomerProtected = (secret: Secret): boolean => secret.protection === "customer";

/** Throws unless `version` is a version number, or `"latest"` where allowed. */
const assertVersion = (version: unknown, allowLatest: boolean): void => {
  if (allowLatest && version === "latest") return;
  if (
    !Number.isSafeInteger(version) ||
    (version as number) < 1 ||
    (version as number) > MAX_SECRET_VERSION
  ) {
    throw new HyperbrowserError(
      `version must be an integer from 1 to ${MAX_SECRET_VERSION}${allowLatest ? ' or "latest"' : ""}`
    );
  }
};

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
 * A customer-protected secret's versions are also wrapped locally with your
 * own key (`createCustomerKey()`, or your own `CustomerKey`), so the platform
 * stores nothing it can open alone. Each use passes the reference `unwrap()`
 * returns.
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
    if (params.type !== undefined && (typeof params.type !== "string" || !params.type)) {
      throw invalidRequest('type must be a secret type such as "secret" or "totp"');
    }
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
   * value is checked against its type's rules, and the platform key is
   * checked, before the secret is created, so a bad value never leaves an
   * empty secret behind.
   */
  async create(params: CreateSecretParams): Promise<Secret> {
    const { name, description, type, allowedOrigins, value, customerKey } =
      params ?? ({} as CreateSecretParams);
    if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
      throw new HyperbrowserError(
        "Secret name must be 1-128 letters, digits, '_' or '-', starting with a letter or digit"
      );
    }
    if (type !== undefined && (typeof type !== "string" || !type)) {
      throw invalidRequest('type must be "secret", "totp" or "op_token"');
    }
    const protection = params.protection ?? (customerKey !== undefined ? "customer" : undefined);
    if (protection !== undefined && protection !== "platform" && protection !== "customer") {
      throw invalidRequest('protection must be "platform" or "customer"');
    }
    if (customerKey !== undefined) {
      if (protection !== "customer") {
        throw invalidRequest('customerKey is only for secrets with protection "customer"');
      }
      assertCustomerKey(customerKey);
    }
    if (protection === "customer" && value !== undefined && customerKey === undefined) {
      throw invalidRequest(
        "A customer-protected secret's value is wrapped with your own key: pass customerKey"
      );
    }
    const plaintext = value === undefined ? undefined : secretPlaintext(type ?? "secret", value);
    const sealer =
      plaintext === undefined ? undefined : SecretsSealer.fromPublicKey(await this.getPublicKey());
    const metadata = allowedOrigins === undefined ? undefined : { browser: { allowedOrigins } };

    let secret: Secret;
    try {
      secret = await this.request<Secret>("/secrets", {
        method: "POST",
        body: JSON.stringify({ name, description, type, metadata, protection }),
      });
    } catch (error) {
      return rethrow(error, `Failed to create secret ${name}`);
    }
    if (sealer === undefined || plaintext === undefined) {
      return secret;
    }

    try {
      const version = await this.uploadVersion(secret, sealer, plaintext, customerKey);
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
   * Encrypt `value` locally and store it as the secret's next version. The
   * value is checked against the rules of the secret's type, such as a TOTP
   * seed's format, before it is sealed.
   */
  async addVersion(
    secret: string,
    value: SecretValue,
    options: AddSecretVersionOptions = {}
  ): Promise<SecretVersion> {
    secretValueBytes(value);
    const { customerKey } = options ?? {};
    if (customerKey !== undefined) assertCustomerKey(customerKey);
    const sealer = SecretsSealer.fromPublicKey(await this.getPublicKey());
    try {
      const resolved = await this.resolve(secret);
      const customer = isCustomerProtected(resolved);
      if (customer && customerKey === undefined) {
        throw invalidRequest(
          `Secret ${resolved.name} is customer-protected: pass customerKey to wrap the value with`
        );
      }
      if (!customer && customerKey !== undefined) {
        throw invalidRequest(
          `Secret ${resolved.name} is not customer-protected, so its versions aren't wrapped: omit customerKey`
        );
      }
      const plaintext = secretPlaintext(resolved.type ?? "secret", value);
      return await this.uploadVersion(resolved, sealer, plaintext, customerKey);
    } catch (error) {
      return rethrow(error, `Failed to add a version to secret ${secret}`);
    }
  }

  /**
   * A customer-protected version's wrapped envelope, for unwrapping with
   * your own key. Most callers want `unwrap()`, which also unwraps it.
   */
  async getWrappedVersion(
    secret: string,
    version: number | "latest" = "latest"
  ): Promise<WrappedSecretVersion> {
    assertVersion(version, true);
    try {
      const { id } = await this.resolve(secret);
      return await this.fetchWrapped(id, version);
    } catch (error) {
      return rethrow(error, `Failed to get the wrapped version of secret ${secret}`);
    }
  }

  /**
   * Unwrap a customer-protected version locally with your own key, giving
   * the reference each use passes: as a sandbox's or process's `secrets`
   * entry, or as a 1Password `token`. It is pinned to the version unwrapped.
   * The unwrapped envelope is checked against the digest stored with the
   * version, and only the platform can open it.
   *
   * `customerKey` may be several keys, such as during a rotation; the one
   * whose `kid` wrapped the version is used.
   */
  async unwrap(
    secret: string,
    customerKey: CustomerKey | readonly CustomerKey[],
    options: UnwrapSecretOptions = {}
  ): Promise<UnwrappedSecretReference> {
    const version = options?.version ?? "latest";
    assertVersion(version, true);
    assertCustomerKeys(customerKey);
    try {
      const resolved = await this.resolve(secret);
      const wrapped = await this.fetchWrapped(resolved.id, version);
      const unwrapped = await unwrapVersion(
        wrapped,
        customerKey,
        `Version ${wrapped.version} of secret ${resolved.name}`
      );
      return { name: resolved.name, version: wrapped.version, unwrapped };
    } catch (error) {
      return rethrow(error, `Failed to unwrap secret ${secret}`);
    }
  }

  /**
   * Rewrap a customer-protected secret's versions with a new key, for
   * rotating your own key. Each version is unwrapped with `from` and wrapped
   * with `to` locally; the value never changes and the platform never sees
   * it. Returns the versions rewrapped.
   */
  async rewrap(secret: string, params: RewrapSecretParams): Promise<WrappedSecretVersion[]> {
    const { from, to, versions } = params ?? ({} as RewrapSecretParams);
    assertCustomerKeys(from, "from", { allowEmpty: true });
    assertCustomerKey(to, "to");
    if (versions !== undefined) {
      if (!Array.isArray(versions))
        throw invalidRequest("versions must be an array of version numbers");
      versions.forEach((version) => assertVersion(version, false));
    }
    try {
      const detail = await this.resolveDetail(secret);
      if (!isCustomerProtected(detail)) {
        throw invalidRequest(`Secret ${detail.name} is not customer-protected; it has no wrapping`);
      }
      const wanted =
        versions ??
        detail.versions.filter(({ outerKid }) => outerKid !== to.kid).map(({ version }) => version);
      const rewrapped: WrappedSecretVersion[] = [];
      for (const version of wanted) {
        const wrapped = await this.fetchWrapped(detail.id, version);
        const label = `Version ${version} of secret ${detail.name}`;
        const inner = await unwrapVersion(wrapped, from, label);
        const envelope = await wrapEnvelope(to, inner, detail.encryptionContext);
        rewrapped.push(
          await this.putWrapping(detail.id, version, { envelope, innerDigest: wrapped.innerDigest })
        );
      }
      return rewrapped;
    } catch (error) {
      return rethrow(error, `Failed to rewrap secret ${secret}`);
    }
  }

  /**
   * Replace a customer-protected version's outer envelope with one you
   * wrapped yourself. `innerDigest` must match the version's: only the
   * wrapping changes, never the value. `rewrap()` does this for you.
   */
  async replaceVersionWrapping(
    secret: string,
    version: number,
    params: ReplaceSecretVersionWrappingParams
  ): Promise<WrappedSecretVersion> {
    assertVersion(version, false);
    const { envelope, innerDigest } = params ?? ({} as ReplaceSecretVersionWrappingParams);
    if (typeof envelope !== "string" || !envelope) {
      throw invalidRequest("envelope must be the wrapped envelope");
    }
    if (typeof innerDigest !== "string" || !innerDigest) {
      throw invalidRequest("innerDigest must be the version's innerDigest");
    }
    try {
      const { id } = await this.resolve(secret);
      return await this.putWrapping(id, version, { envelope, innerDigest });
    } catch (error) {
      return rethrow(
        error,
        `Failed to replace the wrapping of version ${version} of secret ${secret}`
      );
    }
  }

  /**
   * Replace the origins a secret may be filled into in browser sessions, or
   * clear them with `null` (it then can't be filled until origins are set
   * again). Not for `op_token` secrets.
   */
  async setAllowedOrigins(secret: string, allowedOrigins: string[] | null): Promise<Secret> {
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
    assertVersion(version, false);
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

  /**
   * Sealed to the context the API returned for the secret; never one built
   * here. With a customer key, the sealed envelope is wrapped to the same
   * context and the API keeps only the wrapped one and the inner digest.
   */
  private async uploadVersion(
    secret: Secret,
    sealer: SecretsSealer,
    plaintext: Buffer,
    customerKey?: CustomerKey
  ) {
    const inner = sealer.seal(secret.encryptionContext, plaintext);
    const body =
      customerKey === undefined
        ? { envelope: inner }
        : {
            envelope: await wrapEnvelope(customerKey, inner, secret.encryptionContext),
            innerDigest: secretEnvelopeDigest(inner),
            innerKid: sealer.kid,
          };
    return this.request<SecretVersion>(`${secretPath(secret.id)}/versions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private fetchWrapped(id: string, version: number | "latest") {
    return this.request<WrappedSecretVersion>(`${secretPath(id)}/versions/${version}/wrapped`);
  }

  private putWrapping(id: string, version: number, body: ReplaceSecretVersionWrappingParams) {
    return this.request<WrappedSecretVersion>(`${secretPath(id)}/versions/${version}/wrapping`, {
      method: "PUT",
      body: JSON.stringify(body),
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
