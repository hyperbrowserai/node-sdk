import { randomUUID } from "crypto";
import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import { ControlAuthError } from "./control-auth-errors";
import {
  normalizeControlPlaneBaseUrl,
  normalizeText,
  OAUTH_REFRESH_EARLY_EXPIRY_MS,
} from "./control-auth-helpers";
import { type OAuthSessionFile } from "./control-auth-types";

export async function loadOAuthSession(
  sessionPath: string,
  expectedBaseUrl: string
): Promise<OAuthSessionFile> {
  let raw: string;
  try {
    raw = await fs.readFile(sessionPath, "utf8");
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

  validateOAuthSession(parsed, expectedBaseUrl);
  return parsed;
}

export function tryLoadOAuthSessionSync(sessionPath: string): OAuthSessionFile | null {
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

export function shouldUseOAuthSession(
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

export function isRefreshTokenExpired(session: OAuthSessionFile): boolean {
  const refreshExpiry = parseTimestamp(session.refresh_token_expiry);
  if (!refreshExpiry) {
    return false;
  }
  return refreshExpiry.getTime() <= Date.now();
}

export function buildRefreshedOAuthSession(
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
    base_url: normalizeControlPlaneBaseUrl(previous.base_url),
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

export async function writeOAuthSessionAtomic(
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
  if (
    expectedBaseUrl &&
    normalizeControlPlaneBaseUrl(session.base_url) !== normalizeControlPlaneBaseUrl(expectedBaseUrl)
  ) {
    throw new ControlAuthError("Saved OAuth session targets a different base URL", {
      code: "oauth_base_url_mismatch",
      retryable: false,
    });
  }
}

function isAccessTokenUsable(session: OAuthSessionFile): boolean {
  const expiry = parseTimestamp(session.expiry);
  if (!expiry || normalizeText(session.access_token) === "") {
    return false;
  }
  return expiry.getTime() - Date.now() > OAUTH_REFRESH_EARLY_EXPIRY_MS;
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
