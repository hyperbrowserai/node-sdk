import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";
import { ControlAuthError, type ControlAuthErrorOptions } from "./control-auth-errors";
import {
  DEFAULT_BASE_URL,
  DEFAULT_LOCK_POLL_INTERVAL_MS,
  DEFAULT_LOCK_STALE_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  ENV_API_KEY,
  ENV_BASE_URL,
  ENV_LOCK_POLL_INTERVAL_MS,
  ENV_LOCK_STALE_MS,
  ENV_LOCK_TIMEOUT_MS,
  ENV_PROFILE,
  normalizeControlPlaneBaseUrl,
  normalizePositiveInteger,
  normalizeProfile,
  normalizeText,
  redactSensitiveDetails,
  resolveOAuthSessionPath,
  resolveOAuthTokenUrl,
} from "./control-auth-helpers";
import {
  clearStaleRotationLock as clearRotationLockIfStale,
  releaseRotationLock as releaseAcquiredRotationLock,
  tryAcquireRotationLock as acquireRotationLock,
  tryReadSessionMtimeMs,
  type LockHandle,
} from "./control-auth-lock";
import { isReplayableBody, RequestInitFactory, resolveRequestInit } from "./control-auth-request";
import {
  buildRefreshedOAuthSession,
  isRefreshTokenExpired,
  loadOAuthSession,
  shouldUseOAuthSession,
  tryLoadOAuthSessionSync,
  writeOAuthSessionAtomic,
} from "./control-auth-session-store";
import {
  type AuthorizedHeaders,
  type ControlPlaneAuthMode,
  type OAuthControlPlaneAuthMode,
  type OAuthSessionFile,
} from "./control-auth-types";

type ResolvedControlPlaneConfig = {
  baseUrl: string;
  authManager: ControlPlaneAuthManager;
};

export { ControlAuthError, type ControlAuthErrorOptions };
export { normalizeControlPlaneBaseUrl };
export type { RequestInitFactory };

export function resolveControlPlaneConfig(
  config: HyperbrowserConfig = {}
): ResolvedControlPlaneConfig {
  const explicitApiKey = normalizeText(config.apiKey);
  const envApiKey = normalizeText(process.env[ENV_API_KEY]);
  const explicitBaseUrl = normalizeControlPlaneBaseUrl(config.baseUrl);
  const envBaseUrl = normalizeControlPlaneBaseUrl(process.env[ENV_BASE_URL]);
  const configuredBaseUrl = explicitBaseUrl || envBaseUrl;

  if (explicitApiKey || envApiKey) {
    return {
      baseUrl: configuredBaseUrl || DEFAULT_BASE_URL,
      authManager: new ControlPlaneAuthManager({
        kind: "api_key",
        apiKey: explicitApiKey || envApiKey || "",
      }),
    };
  }

  const profile = normalizeProfile(config.profile || process.env[ENV_PROFILE]);
  const sessionPath = resolveOAuthSessionPath(profile);
  const session = tryLoadOAuthSessionSync(sessionPath);
  const resolvedBaseUrl =
    configuredBaseUrl || normalizeControlPlaneBaseUrl(session?.base_url) || DEFAULT_BASE_URL;

  if (!session) {
    throw new ControlAuthError(
      "API key is required - either pass it in config, set HYPERBROWSER_API_KEY, or save an OAuth session with hx auth login",
      {
        code: "missing_auth",
        retryable: false,
      }
    );
  }

  if (configuredBaseUrl && normalizeControlPlaneBaseUrl(session.base_url) !== resolvedBaseUrl) {
    throw new ControlAuthError(
      `Saved OAuth session for profile ${profile} targets ${normalizeControlPlaneBaseUrl(session.base_url)}, not ${resolvedBaseUrl}`,
      {
        code: "oauth_base_url_mismatch",
        retryable: false,
      }
    );
  }

  return {
    baseUrl: resolvedBaseUrl,
    authManager: new ControlPlaneAuthManager({
      kind: "oauth",
      profile,
      sessionPath,
      lockPath: `${sessionPath}.refresh.lock`,
      baseUrl: resolvedBaseUrl,
      lockTimeoutMs: normalizePositiveInteger(
        config.authLockTimeoutMs,
        process.env[ENV_LOCK_TIMEOUT_MS],
        DEFAULT_LOCK_TIMEOUT_MS
      ),
      lockPollIntervalMs: normalizePositiveInteger(
        config.authLockPollIntervalMs,
        process.env[ENV_LOCK_POLL_INTERVAL_MS],
        DEFAULT_LOCK_POLL_INTERVAL_MS
      ),
      lockStaleMs: normalizePositiveInteger(
        config.authLockStaleMs,
        process.env[ENV_LOCK_STALE_MS],
        DEFAULT_LOCK_STALE_MS
      ),
    }),
  };
}

export class ControlPlaneAuthManager {
  constructor(private readonly mode: ControlPlaneAuthMode) {}

  get isOAuth(): boolean {
    return this.mode.kind === "oauth";
  }

  async fetch(
    url: string,
    init: RequestInit | RequestInitFactory = {},
    timeout: number
  ): Promise<Response> {
    const firstAttempt = await this.execute(url, init, timeout, false);
    if (firstAttempt.response.status !== 401 || firstAttempt.accessToken === undefined) {
      return firstAttempt.response;
    }

    if (!this.canReplayRequest(init, firstAttempt.init)) {
      return firstAttempt.response;
    }

    (firstAttempt.response.body as { destroy?: () => void } | null)?.destroy?.();
    const retryAttempt = await this.execute(url, init, timeout, true, firstAttempt.accessToken);
    return retryAttempt.response;
  }

  private async execute(
    url: string,
    init: RequestInit | RequestInitFactory,
    timeout: number,
    forceRefresh: boolean,
    rejectedAccessToken?: string
  ): Promise<{ response: Response; accessToken?: string; init: RequestInit }> {
    const requestInit = await resolveRequestInit(init);
    const authorization = await this.getAuthorizedHeaders(forceRefresh, rejectedAccessToken);
    return {
      response: await fetch(url, {
        ...requestInit,
        timeout,
        headers: {
          ...(requestInit.headers as Record<string, string> | undefined),
          ...authorization.headers,
        },
      }),
      accessToken: authorization.accessToken,
      init: requestInit,
    };
  }

  private canReplayRequest(
    init: RequestInit | RequestInitFactory,
    resolvedInit: RequestInit
  ): boolean {
    if (typeof init === "function") {
      return true;
    }
    return isReplayableBody(resolvedInit.body);
  }

  private async getAuthorizedHeaders(
    forceRefresh: boolean,
    rejectedAccessToken?: string
  ): Promise<AuthorizedHeaders> {
    if (this.mode.kind === "api_key") {
      return {
        headers: {
          "x-api-key": this.mode.apiKey,
        },
      };
    }

    const accessToken = await this.resolveOAuthAccessToken(forceRefresh, rejectedAccessToken);
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      accessToken,
    };
  }

  private async resolveOAuthAccessToken(
    forceRefresh: boolean,
    rejectedAccessToken?: string
  ): Promise<string> {
    const oauthMode = this.requireOAuthMode();
    let session = await loadOAuthSession(oauthMode.sessionPath, oauthMode.baseUrl);
    let sessionMtimeMs = await tryReadSessionMtimeMs(oauthMode.sessionPath);
    if (shouldUseOAuthSession(session, forceRefresh, rejectedAccessToken)) {
      return session.access_token.trim();
    }

    const deadline = Date.now() + oauthMode.lockTimeoutMs;
    while (true) {
      const lockHandle = await this.tryAcquireRotationLock();
      if (lockHandle) {
        try {
          session = await loadOAuthSession(oauthMode.sessionPath, oauthMode.baseUrl);
          sessionMtimeMs = await tryReadSessionMtimeMs(oauthMode.sessionPath);
          if (shouldUseOAuthSession(session, forceRefresh, rejectedAccessToken)) {
            return session.access_token.trim();
          }
          if (isRefreshTokenExpired(session)) {
            throw new ControlAuthError("OAuth session refresh token expired", {
              code: "oauth_session_expired",
              retryable: false,
            });
          }
          const refreshed = await this.refreshOAuthSession(oauthMode, session);
          return refreshed.access_token.trim();
        } finally {
          await releaseAcquiredRotationLock(oauthMode.lockPath, lockHandle);
        }
      }

      await clearRotationLockIfStale(oauthMode.lockPath, oauthMode.lockStaleMs);
      if (Date.now() > deadline) {
        throw new ControlAuthError("Timed out waiting for OAuth rotation lock", {
          code: "auth_rotation_timeout",
          retryable: false,
        });
      }

      await sleep(oauthMode.lockPollIntervalMs);
      const nextSessionMtimeMs = await tryReadSessionMtimeMs(oauthMode.sessionPath);
      if (nextSessionMtimeMs === sessionMtimeMs) {
        continue;
      }
      sessionMtimeMs = nextSessionMtimeMs;
      session = await loadOAuthSession(oauthMode.sessionPath, oauthMode.baseUrl);
      if (shouldUseOAuthSession(session, true, rejectedAccessToken)) {
        return session.access_token.trim();
      }
      if (isRefreshTokenExpired(session)) {
        throw new ControlAuthError("OAuth session refresh token expired", {
          code: "oauth_session_expired",
          retryable: false,
        });
      }
    }
  }

  private async refreshOAuthSession(
    oauthMode: OAuthControlPlaneAuthMode,
    session: OAuthSessionFile
  ): Promise<OAuthSessionFile> {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", normalizeText(session.client_id) || "hyperbrowser-cli");
    body.set("refresh_token", normalizeText(session.refresh_token));

    let response: Response;
    try {
      response = await fetch(resolveOAuthTokenUrl(oauthMode.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        timeout: oauthMode.lockTimeoutMs,
      });
    } catch (error) {
      throw new ControlAuthError("Failed to refresh OAuth session", {
        code: "oauth_refresh_failed",
        retryable: true,
        cause: error,
      });
    }

    const rawText = await response.text();
    let payload: Record<string, unknown> = {};
    if (rawText) {
      try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const message =
        normalizeText(typeof payload.message === "string" ? payload.message : "") ||
        normalizeText(typeof payload.error === "string" ? payload.error : "") ||
        `OAuth refresh failed with status ${response.status}`;
      throw new ControlAuthError(message, {
        statusCode: response.status,
        code:
          normalizeText(typeof payload.code === "string" ? payload.code : "") ||
          "oauth_refresh_failed",
        retryable: false,
        details: redactSensitiveDetails(payload),
      });
    }

    const refreshed = buildRefreshedOAuthSession(session, payload);
    await writeOAuthSessionAtomic(oauthMode.sessionPath, refreshed);
    return refreshed;
  }

  private requireOAuthMode(): OAuthControlPlaneAuthMode {
    if (this.mode.kind !== "oauth") {
      throw new ControlAuthError("OAuth auth is not configured", {
        code: "missing_auth",
        retryable: false,
      });
    }

    return this.mode;
  }

  private async tryAcquireRotationLock(): Promise<LockHandle | null> {
    return acquireRotationLock(this.requireOAuthMode().lockPath);
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
