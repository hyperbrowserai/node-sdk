import { homedir } from "os";
import * as path from "path";

export const DEFAULT_PROFILE = "default";
export const DEFAULT_BASE_URL = "https://api.hyperbrowser.ai";
export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
export const DEFAULT_LOCK_POLL_INTERVAL_MS = 125;
export const DEFAULT_LOCK_STALE_MS = 120_000;
export const OAUTH_REFRESH_EARLY_EXPIRY_MS = 30_000;
export const ENV_PROFILE = "HYPERBROWSER_PROFILE";
export const ENV_API_KEY = "HYPERBROWSER_API_KEY";
export const ENV_BASE_URL = "HYPERBROWSER_BASE_URL";
export const ENV_LOCK_TIMEOUT_MS = "HYPERBROWSER_AUTH_LOCK_TIMEOUT_MS";
export const ENV_LOCK_POLL_INTERVAL_MS = "HYPERBROWSER_AUTH_LOCK_POLL_INTERVAL_MS";
export const ENV_LOCK_STALE_MS = "HYPERBROWSER_AUTH_LOCK_STALE_MS";

export function resolveOAuthSessionPath(profile: string): string {
  return path.join(homedir(), ".hx_config", "auth", `${profile}.json`);
}

export function normalizeProfile(value: string): string {
  const normalized = normalizeText(value);
  return normalized || DEFAULT_PROFILE;
}

export function normalizeControlPlaneBaseUrl(value?: string | null): string {
  const normalized = normalizeText(value);
  return normalized.replace(/\/+$/, "").replace(/\/api$/, "");
}

export function normalizeText(value?: string | null): string {
  return (value || "").trim();
}

export function normalizePositiveInteger(
  explicitValue: number | undefined,
  envValue: string | undefined,
  fallback: number
): number {
  if (typeof explicitValue === "number" && Number.isFinite(explicitValue) && explicitValue > 0) {
    return explicitValue;
  }
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export function resolveOAuthTokenUrl(baseUrl: string): string {
  return new URL("/oauth/token", `${baseUrl}/`).toString();
}
