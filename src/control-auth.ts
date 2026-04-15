import { randomUUID } from "crypto";
import { promises as fs, readFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import fetch, { RequestInit, Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";

const DEFAULT_PROFILE = "default";
const DEFAULT_BASE_URL = "https://api.hyperbrowser.ai";
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 125;
const DEFAULT_LOCK_STALE_MS = 120_000;
const OAUTH_REFRESH_EARLY_EXPIRY_MS = 30_000;
const ENV_PROFILE = "HYPERBROWSER_PROFILE";
const ENV_API_KEY = "HYPERBROWSER_API_KEY";
const ENV_BASE_URL = "HYPERBROWSER_BASE_URL";
const ENV_LOCK_TIMEOUT_MS = "HYPERBROWSER_AUTH_LOCK_TIMEOUT_MS";
const ENV_LOCK_POLL_INTERVAL_MS = "HYPERBROWSER_AUTH_LOCK_POLL_INTERVAL_MS";
const ENV_LOCK_STALE_MS = "HYPERBROWSER_AUTH_LOCK_STALE_MS";

export interface ControlAuthErrorOptions {
  statusCode?: number;
  code?: string;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class ControlAuthError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly retryable: boolean;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  constructor(message: string, options: ControlAuthErrorOptions = {}) {
    super(message);
    this.name = "ControlAuthError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

type OAuthSessionFile = {
  version: number;
  base_url: string;
  client_id: string;
  token_type?: string;
  access_token: string;
  refresh_token: string;
  expiry: string;
  scope?: string;
  refresh_token_expiry?: string;
};

type ResolvedControlPlaneConfig = {
  baseUrl: string;
  authManager: ControlPlaneAuthManager;
};

type ControlPlaneAuthMode =
  | {
      kind: "api_key";
      apiKey: string;
    }
  | {
      kind: "oauth";
      profile: string;
      sessionPath: string;
      lockPath: string;
      baseUrl: string;
      lockTimeoutMs: number;
      lockPollIntervalMs: number;
      lockStaleMs: number;
    };

type AuthorizedHeaders = {
  headers: Record<string, string>;
  accessToken?: string;
};

export type RequestInitFactory = () => RequestInit | Promise<RequestInit>;

export function resolveControlPlaneConfig(
  config: HyperbrowserConfig = {}
): ResolvedControlPlaneConfig {
  const profile = normalizeProfile(config.profile || process.env[ENV_PROFILE] || DEFAULT_PROFILE);
  const explicitApiKey = normalizeText(config.apiKey);
  const envApiKey = normalizeText(process.env[ENV_API_KEY]);
  const explicitBaseUrl = normalizeBaseUrl(config.baseUrl);
  const envBaseUrl = normalizeBaseUrl(process.env[ENV_BASE_URL]);
  const sessionPath = resolveOAuthSessionPath(profile);
  const session = !explicitApiKey && !envApiKey ? tryLoadOAuthSessionSync(sessionPath) : null;
  const resolvedBaseUrl =
    explicitBaseUrl || envBaseUrl || normalizeBaseUrl(session?.base_url) || DEFAULT_BASE_URL;

  if (explicitApiKey || envApiKey) {
    return {
      baseUrl: resolvedBaseUrl,
      authManager: new ControlPlaneAuthManager({
        kind: "api_key",
        apiKey: explicitApiKey || envApiKey || "",
      }),
    };
  }

  if (!session) {
    throw new ControlAuthError(
      "API key is required - either pass it in config, set HYPERBROWSER_API_KEY, or save an OAuth session with hx auth login",
      {
        code: "missing_auth",
        retryable: false,
      }
    );
  }

  if (normalizeBaseUrl(session.base_url) !== resolvedBaseUrl) {
    throw new ControlAuthError(
      `Saved OAuth session for profile ${profile} targets ${normalizeBaseUrl(session.base_url)}, not ${resolvedBaseUrl}`,
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
    if (this.mode.kind !== "oauth") {
      throw new ControlAuthError("OAuth auth is not configured", {
        code: "missing_auth",
        retryable: false,
      });
    }

    let session = await this.loadOAuthSession();
    if (shouldUseOAuthSession(session, forceRefresh, rejectedAccessToken)) {
      return session.access_token.trim();
    }

    const deadline = Date.now() + this.mode.lockTimeoutMs;
    while (true) {
      const lockHandle = await this.tryAcquireRotationLock();
      if (lockHandle) {
        try {
          session = await this.loadOAuthSession();
          if (shouldUseOAuthSession(session, forceRefresh, rejectedAccessToken)) {
            return session.access_token.trim();
          }
          if (isRefreshTokenExpired(session)) {
            throw new ControlAuthError("OAuth session refresh token expired", {
              code: "oauth_session_expired",
              retryable: false,
            });
          }
          const refreshed = await this.refreshOAuthSession(session);
          return refreshed.access_token.trim();
        } finally {
          await releaseRotationLock(this.mode.lockPath, lockHandle);
        }
      }

      await this.clearStaleRotationLock();
      if (Date.now() > deadline) {
        throw new ControlAuthError("Timed out waiting for OAuth rotation lock", {
          code: "auth_rotation_timeout",
          retryable: false,
        });
      }

      await sleep(this.mode.lockPollIntervalMs);
      session = await this.loadOAuthSession();
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

  private async loadOAuthSession(): Promise<OAuthSessionFile> {
    if (this.mode.kind !== "oauth") {
      throw new ControlAuthError("OAuth auth is not configured", {
        code: "missing_auth",
        retryable: false,
      });
    }

    let raw: string;
    try {
      raw = await fs.readFile(this.mode.sessionPath, "utf8");
    } catch (error) {
      throw new ControlAuthError("Failed to read saved OAuth session", {
        code: "oauth_session_read_failed",
        retryable: false,
        cause: error,
      });
    }

    let parsed: OAuthSessionFile;
    try {
      parsed = JSON.parse(raw) as OAuthSessionFile;
    } catch (error) {
      throw new ControlAuthError("Saved OAuth session is invalid JSON", {
        code: "oauth_session_invalid",
        retryable: false,
        cause: error,
      });
    }

    validateOAuthSession(parsed, this.mode.baseUrl);
    return parsed;
  }

  private async refreshOAuthSession(session: OAuthSessionFile): Promise<OAuthSessionFile> {
    if (this.mode.kind !== "oauth") {
      throw new ControlAuthError("OAuth auth is not configured", {
        code: "missing_auth",
        retryable: false,
      });
    }

    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", normalizeText(session.client_id) || "hyperbrowser-cli");
    body.set("refresh_token", normalizeText(session.refresh_token));

    let response: Response;
    try {
      response = await fetch(`${this.mode.baseUrl}/oauth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        timeout: this.mode.lockTimeoutMs,
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
        details: payload,
      });
    }

    const refreshed = buildRefreshedOAuthSession(session, payload);
    await writeOAuthSessionAtomic(this.mode.sessionPath, refreshed);
    return refreshed;
  }

  private async tryAcquireRotationLock() {
    if (this.mode.kind !== "oauth") {
      return null;
    }

    await fs.mkdir(path.dirname(this.mode.lockPath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.chmod(path.dirname(this.mode.lockPath), 0o700).catch(() => undefined);

    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(this.mode.lockPath, "wx", 0o600);
      await handle.writeFile(
        `pid=${process.pid}\ncreated_at=${new Date().toISOString()}\n`,
        "utf8"
      );
      await handle.sync();
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return null;
      }
      await handle?.close().catch(() => undefined);
      if (handle) {
        await fs
          .rm(this.mode.lockPath, {
            force: true,
          })
          .catch(() => undefined);
      }
      throw new ControlAuthError("Failed to create OAuth rotation lock", {
        code: "auth_rotation_lock_failed",
        retryable: false,
        cause: error,
      });
    }
  }

  private async clearStaleRotationLock(): Promise<void> {
    if (this.mode.kind !== "oauth") {
      return;
    }

    let info;
    try {
      info = await fs.stat(this.mode.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw new ControlAuthError("Failed to inspect OAuth rotation lock", {
        code: "auth_rotation_lock_failed",
        retryable: false,
        cause: error,
      });
    }

    if (Date.now() - info.mtimeMs < this.mode.lockStaleMs) {
      return;
    }

    await fs.rm(this.mode.lockPath, {
      force: true,
    });
  }
}

function tryLoadOAuthSessionSync(sessionPath: string): OAuthSessionFile | null {
  let raw: string;
  try {
    raw = readFileSync(sessionPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new ControlAuthError("Failed to read saved OAuth session", {
      code: "oauth_session_read_failed",
      retryable: false,
      cause: error,
    });
  }

  let parsed: OAuthSessionFile;
  try {
    parsed = JSON.parse(raw) as OAuthSessionFile;
  } catch (error) {
    throw new ControlAuthError("Saved OAuth session is invalid JSON", {
      code: "oauth_session_invalid",
      retryable: false,
      cause: error,
    });
  }

  validateOAuthSession(parsed);
  return parsed;
}

function validateOAuthSession(session: OAuthSessionFile, expectedBaseUrl?: string): void {
  if (!session || typeof session !== "object") {
    throw new ControlAuthError("Saved OAuth session is missing", {
      code: "oauth_session_invalid",
      retryable: false,
    });
  }
  if (normalizeText(session.access_token) === "" || normalizeText(session.refresh_token) === "") {
    throw new ControlAuthError("Saved OAuth session is missing tokens", {
      code: "oauth_session_invalid",
      retryable: false,
    });
  }
  if (!parseTimestamp(session.expiry)) {
    throw new ControlAuthError("Saved OAuth session has an invalid expiry", {
      code: "oauth_session_invalid",
      retryable: false,
    });
  }
  if (
    normalizeText(session.refresh_token_expiry) !== "" &&
    !parseTimestamp(session.refresh_token_expiry)
  ) {
    throw new ControlAuthError("Saved OAuth session has an invalid refresh token expiry", {
      code: "oauth_session_invalid",
      retryable: false,
    });
  }
  if (expectedBaseUrl && normalizeBaseUrl(session.base_url) !== normalizeBaseUrl(expectedBaseUrl)) {
    throw new ControlAuthError("Saved OAuth session targets a different base URL", {
      code: "oauth_base_url_mismatch",
      retryable: false,
    });
  }
}

function shouldUseOAuthSession(
  session: OAuthSessionFile,
  forceRefresh: boolean,
  rejectedAccessToken?: string
): boolean {
  if (!isAccessTokenUsable(session)) {
    return false;
  }
  if (!forceRefresh) {
    return true;
  }
  return normalizeText(session.access_token) !== normalizeText(rejectedAccessToken);
}

function isAccessTokenUsable(session: OAuthSessionFile): boolean {
  const expiry = parseTimestamp(session.expiry);
  if (!expiry || normalizeText(session.access_token) === "") {
    return false;
  }
  return expiry.getTime() - Date.now() > OAUTH_REFRESH_EARLY_EXPIRY_MS;
}

function isRefreshTokenExpired(session: OAuthSessionFile): boolean {
  const refreshExpiry = parseTimestamp(session.refresh_token_expiry);
  if (!refreshExpiry) {
    return false;
  }
  return refreshExpiry.getTime() <= Date.now();
}

function buildRefreshedOAuthSession(
  previous: OAuthSessionFile,
  payload: Record<string, unknown>
): OAuthSessionFile {
  const nextAccessToken = normalizeText(
    typeof payload.access_token === "string" ? payload.access_token : ""
  );
  if (!nextAccessToken) {
    throw new ControlAuthError("OAuth refresh response did not include an access token", {
      code: "oauth_refresh_failed",
      retryable: false,
      details: payload,
    });
  }

  const nextRefreshToken =
    normalizeText(typeof payload.refresh_token === "string" ? payload.refresh_token : "") ||
    normalizeText(previous.refresh_token);
  const nextTokenType =
    normalizeText(typeof payload.token_type === "string" ? payload.token_type : "") ||
    normalizeText(previous.token_type) ||
    "Bearer";
  const expiresAt = deriveOAuthExpiry(payload, "expires_in") || normalizeText(previous.expiry);
  const refreshTokenExpiry =
    deriveOAuthExpiry(payload, "refresh_token_expires_in") ||
    normalizeText(previous.refresh_token_expiry);

  return {
    version: previous.version,
    base_url: normalizeBaseUrl(previous.base_url),
    client_id: normalizeText(previous.client_id) || "hyperbrowser-cli",
    token_type: nextTokenType,
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    expiry: expiresAt,
    scope:
      normalizeText(typeof payload.scope === "string" ? payload.scope : "") ||
      normalizeText(previous.scope),
    refresh_token_expiry: refreshTokenExpiry || undefined,
  };
}

async function writeOAuthSessionAtomic(
  sessionPath: string,
  session: OAuthSessionFile
): Promise<void> {
  const authDir = path.dirname(sessionPath);
  await fs.mkdir(authDir, {
    recursive: true,
    mode: 0o700,
  });
  await fs.chmod(authDir, 0o700).catch(() => undefined);

  const tempPath = path.join(
    authDir,
    `${path.basename(sessionPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  const payload = `${JSON.stringify(session, null, 2)}\n`;
  const handle = await fs.open(tempPath, "wx", 0o600);
  let renamed = false;

  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    await fs.rename(tempPath, sessionPath);
    renamed = true;
    await fs.chmod(sessionPath, 0o600).catch(() => undefined);
  } finally {
    if (!renamed) {
      await handle.close().catch(() => undefined);
      await fs
        .rm(tempPath, {
          force: true,
        })
        .catch(() => undefined);
    }
  }
}

async function releaseRotationLock(lockPath: string, handle: Awaited<ReturnType<typeof fs.open>>) {
  await handle.close().catch(() => undefined);
  await fs
    .rm(lockPath, {
      force: true,
    })
    .catch(() => undefined);
}

function resolveOAuthSessionPath(profile: string): string {
  return path.join(homedir(), ".hx_config", "auth", `${profile}.json`);
}

function normalizeProfile(value: string): string {
  const normalized = normalizeText(value);
  return normalized || DEFAULT_PROFILE;
}

function normalizeBaseUrl(value?: string | null): string {
  const normalized = normalizeText(value);
  return normalized.replace(/\/+$/, "");
}

function normalizeText(value?: string | null): string {
  return (value || "").trim();
}

function parseTimestamp(value?: string | null): Date | null {
  const normalized = normalizeText(value || "");
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function deriveOAuthExpiry(payload: Record<string, unknown>, key: string): string | undefined {
  const raw = payload[key];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return new Date(Date.now() + raw * 1000).toISOString();
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(Date.now() + parsed * 1000).toISOString();
    }
  }
  return undefined;
}

function normalizePositiveInteger(
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

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function resolveRequestInit(init: RequestInit | RequestInitFactory): Promise<RequestInit> {
  return typeof init === "function" ? await init() : init;
}

function isReplayableBody(body: RequestInit["body"]): boolean {
  if (body == null) {
    return true;
  }
  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof URLSearchParams) {
    return true;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return true;
  }
  return false;
}
