export interface HyperbrowserConfig {
  /** API key used for control-plane requests. Falls back to `HYPERBROWSER_API_KEY`. */
  apiKey?: string;

  /**
   * Control-plane origin used for API and OAuth requests.
   * Falls back to `HYPERBROWSER_BASE_URL`.
   * A trailing `/api` is normalized away for compatibility with existing configs.
   */
  baseUrl?: string;

  /**
   * Saved OAuth profile name from `~/.hx_config/auth/<profile>.json`.
   * Falls back to `HYPERBROWSER_PROFILE`.
   * Only letters, numbers, dots, underscores, and hyphens are allowed.
   */
  profile?: string;

  /** Request timeout in milliseconds. */
  timeout?: number;

  /** Optional runtime proxy override used for sandbox transport endpoints. */
  runtimeProxyOverride?: string;

  /**
   * Maximum time in milliseconds to wait for the OAuth refresh lock.
   * Falls back to `HYPERBROWSER_AUTH_LOCK_TIMEOUT_MS`.
   */
  authLockTimeoutMs?: number;

  /**
   * Poll interval in milliseconds while waiting for the OAuth refresh lock.
   * Falls back to `HYPERBROWSER_AUTH_LOCK_POLL_INTERVAL_MS`.
   */
  authLockPollIntervalMs?: number;

  /**
   * Lock age in milliseconds after which a stale OAuth refresh lock can be cleared.
   * Falls back to `HYPERBROWSER_AUTH_LOCK_STALE_MS`.
   */
  authLockStaleMs?: number;
}
