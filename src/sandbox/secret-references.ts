import { HyperbrowserError, invalidRequest } from "../error";
import { isPlainObject } from "../secrets-envelope";
import { SandboxSecrets } from "../types/sandbox";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The longest environment variable name the API stores. */
const MAX_ENV_NAME_LENGTH = 256;
/** Names of secrets and vaults. */
export const SECRET_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
/** The largest version number the API stores. */
export const MAX_SECRET_VERSION = 2_147_483_647;
const MAX_SECRETS = 32;
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

/** An environment variable name the API accepts for a secret or a vault entry. */
export const isSecretEnvName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length <= MAX_ENV_NAME_LENGTH &&
  ENV_NAME_PATTERN.test(name) &&
  name !== "__proto__";

/** A vault name, checked locally before it is sent. */
export const checkVaultName = (vault: unknown, what = "vault"): string => {
  if (typeof vault !== "string" || !SECRET_NAME_PATTERN.test(vault)) {
    throw new HyperbrowserError(
      `${what} must be a vault name: 1-128 letters, digits, '_' or '-', starting with a letter or digit`,
      { code: "invalid_request", retryable: false }
    );
  }
  return vault;
};

export interface WireSecretReference {
  name: string;
  version?: number | "latest";
}

/**
 * Check secret references locally and convert them to the API's
 * `{ name, version? }` shape. Returns undefined when there are none.
 */
export const serializeSecretReferences = (
  secrets: SandboxSecrets | undefined
): Record<string, WireSecretReference> | undefined => {
  if (secrets === undefined || secrets === null) {
    return undefined;
  }
  if (typeof secrets !== "object" || Array.isArray(secrets)) {
    throw new HyperbrowserError("secrets must map environment variable names to secrets");
  }
  const entries = Object.entries(secrets);
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length > MAX_SECRETS) {
    throw new HyperbrowserError(`At most ${MAX_SECRETS} secrets can be delivered at once`);
  }
  const wire: Record<string, WireSecretReference> = {};
  for (const [env, reference] of entries) {
    if (!isSecretEnvName(env)) {
      throw new HyperbrowserError(`Invalid environment variable name for a secret: ${env}`);
    }
    const { name, version } =
      typeof reference === "string" ? { name: reference, version: undefined } : (reference ?? {});
    if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
      throw new HyperbrowserError(`Invalid secret name for ${env}: ${String(name)}`);
    }
    if (
      version !== undefined &&
      version !== "latest" &&
      (!Number.isSafeInteger(version) ||
        (version as number) < 1 ||
        (version as number) > MAX_SECRET_VERSION)
    ) {
      throw new HyperbrowserError(
        `Secret version for ${env} must be an integer from 1 to ${MAX_SECRET_VERSION} or "latest"`
      );
    }
    wire[env] = version === undefined ? { name } : { name, version };
  }
  return wire;
};

/** An environment variable must come from either `env` or `secrets`, not both. */
export const assertNoEnvSecretOverlap = (
  env: Record<string, string> | undefined,
  secrets: Record<string, WireSecretReference>
): void => {
  const overlap = Object.keys(env ?? {}).filter((name) =>
    Object.prototype.hasOwnProperty.call(secrets, name)
  );
  if (overlap.length > 0) {
    throw new HyperbrowserError(
      `Environment variables set by both env and secrets: ${overlap.sort().join(", ")}`
    );
  }
};

export interface WireOnePasswordField {
  item: string;
  section?: string;
  field: string;
}

export interface WireOnePassword {
  token: string;
  vault: string;
  fields: Record<string, WireOnePasswordField>;
}

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

/** The API refuses unknown members, so refuse them before sending. */
export const checkMembers = (
  value: Record<string, unknown>,
  allowed: string[],
  what: string
): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw invalidRequest(`${what} has unknown members: ${unknown.sort().join(", ")}`);
  }
};

/** The `op_token` secret a 1Password source signs in with, by name. */
export const checkOnePasswordToken = (token: unknown, what = "onePassword.token"): string => {
  if (typeof token !== "string" || !SECRET_NAME_PATTERN.test(token)) {
    throw invalidRequest(`${what} must be the name of an op_token secret`);
  }
  return token;
};

/** The 1Password vault's name or ID. */
export const checkOnePasswordVault = (vault: unknown, what = "onePassword.vault"): string => {
  checkOnePasswordPart(vault, what);
  return vault as string;
};

/**
 * Check a field of an item in `vault`, `{ item, section?, field }`, and its
 * full op:// reference, and convert it to the API's shape.
 */
export const serializeOnePasswordField = (
  entry: unknown,
  vault: string,
  what: string
): WireOnePasswordField => {
  if (!isPlainObject(entry)) {
    throw invalidRequest(`${what} must be { item, section?, field }`);
  }
  checkMembers(entry, ["item", "section", "field"], what);
  const { item, section, field } = entry;
  checkOnePasswordPart(item, `${what}.item`);
  if (section !== undefined) checkOnePasswordPart(section, `${what}.section`);
  checkOnePasswordPart(field, `${what}.field`, ONEPASSWORD_FIELD_PATTERN);
  const reference = `op://${[vault, item, ...(section === undefined ? [] : [section]), field].join("/")}`;
  if (Buffer.byteLength(reference, "utf8") > MAX_ONEPASSWORD_REFERENCE_BYTES) {
    throw invalidRequest(
      `${what}: the 1Password reference is more than ${MAX_ONEPASSWORD_REFERENCE_BYTES} bytes`
    );
  }
  return (
    section === undefined ? { item, field } : { item, section, field }
  ) as WireOnePasswordField;
};

/**
 * Check `onePassword` locally and convert it to the API's shape. Returns
 * undefined when it isn't given.
 */
export const serializeOnePassword = (onePassword: unknown): WireOnePassword | undefined => {
  if (onePassword === undefined) {
    return undefined;
  }
  if (!isPlainObject(onePassword)) {
    throw invalidRequest("onePassword must be { token, vault, fields }");
  }
  checkMembers(onePassword, ["token", "vault", "fields"], "onePassword");
  const token = checkOnePasswordToken(onePassword.token);
  const vault = checkOnePasswordVault(onePassword.vault);
  const { fields } = onePassword;
  if (!isPlainObject(fields)) {
    throw invalidRequest("onePassword.fields must map environment variable names to fields");
  }
  const entries = Object.entries(fields);
  if (entries.length < 1 || entries.length > MAX_SECRETS) {
    throw invalidRequest(`onePassword.fields must name 1 to ${MAX_SECRETS} fields`);
  }
  const wire: Record<string, WireOnePasswordField> = {};
  for (const [env, entry] of entries) {
    if (!isSecretEnvName(env)) {
      throw invalidRequest(
        `Invalid environment variable name for a 1Password field: ${(env as string).slice(0, 64)}`
      );
    }
    wire[env] = serializeOnePasswordField(entry, vault, `onePassword.fields.${env}`);
  }
  return { token, vault, fields: wire };
};

/**
 * A 1Password field's variable must come from it alone: not also from
 * `secrets` or `env`. A clash with a vault is reported by the API.
 */
export const assertOnePasswordAlone = (
  onePassword: WireOnePassword,
  { secrets, env }: { secrets?: Record<string, unknown>; env?: Record<string, string> }
): void => {
  for (const name of Object.keys(onePassword.fields)) {
    for (const [what, other] of [
      ["secrets", secrets],
      ["env", env],
    ] as const) {
      if (other && Object.prototype.hasOwnProperty.call(other, name)) {
        throw invalidRequest(
          `${name} is set by ${what} and by onePassword; a 1Password field's variable must come from it alone`
        );
      }
    }
  }
  const total = Object.keys(onePassword.fields).length + Object.keys(secrets ?? {}).length;
  if (total > MAX_SECRETS) {
    throw invalidRequest(`At most ${MAX_SECRETS} secrets can be delivered at once`);
  }
};
