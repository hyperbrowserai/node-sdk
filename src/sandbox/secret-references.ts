import { HyperbrowserError } from "../error";
import { SandboxOnePassword, SandboxSecrets, SandboxVaultSource } from "../types/sandbox";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The longest environment variable name the API stores. */
const MAX_ENV_NAME_LENGTH = 256;
/** Names of secrets and vaults. */
export const SECRET_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
/** The largest version number the API stores. */
export const MAX_SECRET_VERSION = 2_147_483_647;
const MAX_SECRETS = 32;
/** The longest unwrapped envelope the API takes. */
const MAX_UNWRAPPED_LENGTH = 64 * 1024;
/** An environment variable name the API accepts for a secret or a vault entry. */
export const isSecretEnvName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length <= MAX_ENV_NAME_LENGTH &&
  ENV_NAME_PATTERN.test(name) &&
  name !== "__proto__";

const isVersionNumber = (version: unknown): version is number =>
  Number.isSafeInteger(version) &&
  (version as number) >= 1 &&
  (version as number) <= MAX_SECRET_VERSION;

const isUnwrappedEnvelope = (unwrapped: unknown): unwrapped is string =>
  typeof unwrapped === "string" &&
  unwrapped.length >= 1 &&
  unwrapped.length <= MAX_UNWRAPPED_LENGTH;

export interface WireSecretReference {
  name: string;
  version?: number | "latest";
  unwrapped?: string;
}

export interface WireVaultReference {
  name: string;
  unwrapped: Record<string, { version: number; unwrapped: string }>;
}

/** A vault as the API takes it: its name, or its name with unwrapped entries. */
export type WireVaultSource = string | WireVaultReference;

export interface WireOnePassword extends Omit<SandboxOnePassword, "token"> {
  token: string | WireSecretReference;
}

/** Check one secret reference and convert it to the API's `{ name, version?, unwrapped? }`. */
const serializeSecretReference = (reference: unknown, label: string): WireSecretReference => {
  const { name, version, unwrapped } = (
    typeof reference === "string" ? { name: reference } : (reference ?? {})
  ) as { name?: unknown; version?: unknown; unwrapped?: unknown };
  if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
    throw new HyperbrowserError(`Invalid secret name for ${label}: ${String(name)}`);
  }
  if (version !== undefined && version !== "latest" && !isVersionNumber(version)) {
    throw new HyperbrowserError(
      `Secret version for ${label} must be an integer from 1 to ${MAX_SECRET_VERSION} or "latest"`
    );
  }
  if (unwrapped === undefined) {
    return version === undefined ? { name } : { name, version: version as number | "latest" };
  }
  if (!isUnwrappedEnvelope(unwrapped)) {
    throw new HyperbrowserError(
      `The unwrapped envelope for ${label} must be a string of 1 to ${MAX_UNWRAPPED_LENGTH} characters`
    );
  }
  // An unwrapped envelope is one version's value; "latest" could move on.
  if (typeof version !== "number") {
    throw new HyperbrowserError(
      `Pin the version of ${label} to the version you unwrapped when passing "unwrapped"`,
      { code: "invalid_request" }
    );
  }
  return { name, version, unwrapped };
};

/**
 * Check secret references locally and convert them to the API's
 * `{ name, version?, unwrapped? }` shape. Returns undefined when there are none.
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
    wire[env] = serializeSecretReference(reference, env);
  }
  return wire;
};

/**
 * Check a vault source and convert it to the API's shape: a name is passed
 * as is, and a `VaultReference` keeps only its name and unwrapped entries.
 */
export const serializeVaultSource = (
  vault: SandboxVaultSource | undefined
): WireVaultSource | undefined => {
  if (vault === undefined || typeof vault === "string") {
    return vault;
  }
  if (!vault || typeof vault !== "object" || Array.isArray(vault)) {
    throw new HyperbrowserError(
      "vault must be a vault's name or the reference vaults.unwrap() returns"
    );
  }
  const { name, unwrapped } = vault;
  if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
    throw new HyperbrowserError(`Invalid vault name: ${String(name)}`);
  }
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    throw new HyperbrowserError(
      `vault.unwrapped must map vault ${name}'s variables to { version, unwrapped }`
    );
  }
  const entries = Object.entries(unwrapped);
  if (entries.length > MAX_SECRETS) {
    throw new HyperbrowserError(`At most ${MAX_SECRETS} unwrapped vault entries are allowed`);
  }
  const wire: WireVaultReference["unwrapped"] = {};
  for (const [env, entry] of entries) {
    if (!isSecretEnvName(env)) {
      throw new HyperbrowserError(`Invalid environment variable name in vault ${name}: ${env}`);
    }
    const { version, unwrapped: envelope } = (entry ?? {}) as {
      version?: unknown;
      unwrapped?: unknown;
    };
    if (!isVersionNumber(version)) {
      throw new HyperbrowserError(
        `The version of vault ${name}'s ${env} must be the integer it was unwrapped from`
      );
    }
    if (!isUnwrappedEnvelope(envelope)) {
      throw new HyperbrowserError(
        `The unwrapped envelope of vault ${name}'s ${env} must be a string of 1 to ${MAX_UNWRAPPED_LENGTH} characters`
      );
    }
    wire[env] = { version, unwrapped: envelope };
  }
  return { name, unwrapped: wire };
};

/**
 * Check a 1Password source's token, the one member that can be a secret
 * reference; the API checks the rest.
 */
export const serializeOnePasswordToken = (
  token: SandboxOnePassword["token"]
): WireOnePassword["token"] =>
  typeof token === "string" ? token : serializeSecretReference(token, "the 1Password token");

/** Serialize a 1Password source, checking its token. */
export const serializeOnePassword = (
  onePassword: SandboxOnePassword | undefined
): WireOnePassword | undefined =>
  onePassword === undefined || onePassword === null || typeof onePassword !== "object"
    ? onePassword
    : { ...onePassword, token: serializeOnePasswordToken(onePassword.token) };

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
