import { SandboxImageInit } from "../../types/sandbox";

const IMAGE_INIT_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_IMAGE_INIT_ENV_KEYS = new Set([
  "SANDBOX_ENABLED",
  "SANDBOX_DEFAULT_WORKING_DIR",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PWD",
  "DISPLAY",
]);

const listStringConfig = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeInitArgs = (values: string[] | undefined | null): string[] =>
  (values ?? []).filter((value) => value);

const deriveAutoImageEnv = (entries: string[]): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = entry.slice(0, separator).trim();
    if (!key || !IMAGE_INIT_ENV_KEY_PATTERN.test(key) || RESERVED_IMAGE_INIT_ENV_KEYS.has(key)) {
      continue;
    }
    env[key] = entry.slice(separator + 1);
  }
  return env;
};

const deriveAutoStartupArgs = (entrypoint: string[], cmd: string[]): string[] =>
  (entrypoint.length > 0 ? [...entrypoint, ...cmd] : [...cmd]).filter((arg) => arg);

/** Derive default sandbox initialization from a Docker image config. */
export const deriveAutoImageInit = (
  config: Record<string, unknown>
): SandboxImageInit | undefined => {
  const env = deriveAutoImageEnv(listStringConfig(config.Env));
  const args = deriveAutoStartupArgs(
    listStringConfig(config.Entrypoint),
    listStringConfig(config.Cmd)
  );
  const workingDir = String(config.WorkingDir ?? "").trim();
  if (Object.keys(env).length === 0 && args.length === 0 && !workingDir) {
    return undefined;
  }
  const init: SandboxImageInit = {};
  if (Object.keys(env).length > 0) {
    init.env = env;
  }
  if (args.length > 0) {
    init.args = args;
  }
  if (workingDir) {
    init.workingDir = workingDir;
  }
  return init;
};

/** Layer explicit overrides over image-derived initialization defaults. */
export const mergeImageInit = (
  automatic: SandboxImageInit | undefined,
  explicit: SandboxImageInit | undefined
): SandboxImageInit | undefined => {
  if (automatic === undefined && explicit === undefined) {
    return undefined;
  }
  const env: Record<string, string> = { ...(automatic?.env ?? {}), ...(explicit?.env ?? {}) };
  let command = (automatic?.command ?? "").trim();
  let args = normalizeInitArgs(automatic?.args);
  let workingDir = (automatic?.workingDir ?? "").trim();
  if (explicit !== undefined) {
    const explicitWorkingDir = (explicit.workingDir ?? "").trim();
    if (explicitWorkingDir) {
      workingDir = explicitWorkingDir;
    }
    const explicitArgs = normalizeInitArgs(explicit.args);
    if (explicitArgs.length > 0) {
      args = explicitArgs;
      command = "";
    }
    const explicitCommand = (explicit.command ?? "").trim();
    if (explicitCommand) {
      command = explicitCommand;
      args = [];
    }
  }
  if (Object.keys(env).length === 0 && !command && args.length === 0 && !workingDir) {
    return undefined;
  }
  const merged: SandboxImageInit = {};
  if (Object.keys(env).length > 0) {
    merged.env = env;
  }
  if (command) {
    merged.command = command;
  }
  if (args.length > 0) {
    merged.args = args;
  }
  if (workingDir) {
    merged.workingDir = workingDir;
  }
  return merged;
};
