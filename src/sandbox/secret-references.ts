import { HyperbrowserError } from "../error";
import { SandboxSecrets } from "../types/sandbox";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SECRET_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
/** The largest version number the API stores. */
export const MAX_SECRET_VERSION = 2_147_483_647;
const MAX_SECRETS = 32;

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
    if (!ENV_NAME_PATTERN.test(env) || env === "__proto__") {
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
