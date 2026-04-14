export interface HyperbrowserConfig {
  apiKey?: string;
  baseUrl?: string;
  profile?: string;
  timeout?: number;
  runtimeProxyOverride?: string;
  authLockTimeoutMs?: number;
  authLockPollIntervalMs?: number;
  authLockStaleMs?: number;
}
