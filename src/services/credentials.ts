import { invalidRequest } from "../error";
import {
  checkMembers,
  checkOnePasswordToken,
  checkOnePasswordVault,
  checkVaultName,
  isSecretEnvName,
  SECRET_NAME_PATTERN,
  serializeOnePasswordField,
} from "../sandbox/secret-references";
import { isPlainObject } from "../secrets-envelope";
import { CredentialFillResult, FillCredentialParams } from "../types/credential";
import { BaseService } from "./base";
import { checkAllowedOrigins } from "./secrets";

const MAX_FIELDS = 16;
/** The most items `credentials` can attach to one session. */
const MAX_SESSION_CREDENTIALS = 20;
const SESSION_CREDENTIAL_KINDS = ["secret", "vault", "onePassword"];
const MAX_CREDENTIAL_LENGTH = 255;
const MAX_SELECTOR_BYTES = 1024;
const MAX_PAGE_ID_BYTES = 128;
const MAX_URL_BYTES = 2048;
/** The API gives up on a fill after about 18 seconds. */
const MIN_FILL_TIMEOUT_MS = 30_000;

const isNonEmptyString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes;

const isGiven = (value: unknown): boolean => value !== undefined && value !== null;

/**
 * @internal Check a session's `credentials` locally as the API would: at
 * most 20 items, each a secret name, or exactly one of `{ secret }`,
 * `{ vault }` or `{ onePassword }` with a name.
 */
export const checkSessionCredentials = (credentials: unknown): void => {
  if (credentials === undefined) {
    return;
  }
  if (!Array.isArray(credentials) || credentials.length > MAX_SESSION_CREDENTIALS) {
    throw invalidRequest(`credentials must be a list of at most ${MAX_SESSION_CREDENTIALS} items`);
  }
  credentials.forEach((entry, index) => {
    const [kind, name] =
      typeof entry === "string"
        ? ["secret", entry]
        : isPlainObject(entry) && Object.keys(entry).length === 1
          ? Object.entries(entry)[0]
          : [undefined, undefined];
    if (
      kind === undefined ||
      !SESSION_CREDENTIAL_KINDS.includes(kind) ||
      typeof name !== "string" ||
      !SECRET_NAME_PATTERN.test(name)
    ) {
      throw invalidRequest(
        `credentials[${index}] must be a secret name, or one of { secret }, { vault } or { onePassword } with a name`
      );
    }
  });
};

const fillBody = (params: FillCredentialParams): string => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Fill parameters must be an object");
  }
  const { credential, vault, onePassword, fields, pageId, pageUrl, frameUrl } = params;
  const withVault = isGiven(vault);
  const withOnePassword = isGiven(onePassword);
  if ([credential, vault, onePassword].filter(isGiven).length !== 1) {
    throw invalidRequest("Pass exactly one of credential (a secret), vault or onePassword");
  }
  let wireOnePassword: { token: string; vault: string; allowedOrigins: string[] } | undefined;
  if (withOnePassword) {
    if (!isPlainObject(onePassword)) {
      throw invalidRequest("onePassword must be { token, vault, allowedOrigins }");
    }
    checkMembers(onePassword, ["token", "vault", "allowedOrigins"], "onePassword");
    const token = checkOnePasswordToken(onePassword.token);
    const opVault = checkOnePasswordVault(onePassword.vault);
    checkAllowedOrigins(onePassword.allowedOrigins, "onePassword.allowedOrigins");
    wireOnePassword = { token, vault: opVault, allowedOrigins: onePassword.allowedOrigins };
  } else if (withVault) {
    checkVaultName(vault);
  } else if (
    typeof credential !== "string" ||
    !credential.trim() ||
    credential.length > MAX_CREDENTIAL_LENGTH
  ) {
    throw invalidRequest("credential must be the name or ID of a secret attached to the session");
  }
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_FIELDS) {
    throw invalidRequest(`fields must list 1-${MAX_FIELDS} inputs`);
  }
  const selectors = new Set<string>();
  const wireFields = fields.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw invalidRequest(`fields[${index}] must be a { selector, field?, ref? } object`);
    }
    const { selector, field, ref } = entry;
    if (!isNonEmptyString(selector, MAX_SELECTOR_BYTES) || !selector.trim()) {
      throw invalidRequest(
        `fields[${index}].selector must be a CSS selector of 1-${MAX_SELECTOR_BYTES} bytes`
      );
    }
    if (selectors.has(selector)) {
      throw invalidRequest(`fields lists the selector ${selector.slice(0, 64)} more than once`);
    }
    selectors.add(selector);
    if (wireOnePassword) {
      if (isGiven(field)) {
        throw invalidRequest(
          `fields[${index}].field is only for vault fills; with onePassword, name the 1Password field in ref`
        );
      }
      if (!isGiven(ref)) {
        throw invalidRequest(
          `fields[${index}].ref must name the 1Password field to type, as { item, section?, field }`
        );
      }
      return {
        selector,
        ref: serializeOnePasswordField(ref, wireOnePassword.vault, `fields[${index}].ref`),
      };
    }
    if (isGiven(ref)) {
      throw invalidRequest(`fields[${index}].ref is only for onePassword fills`);
    }
    if (!withVault) {
      if (isGiven(field)) {
        throw invalidRequest(
          `fields[${index}].field is only for vault fills; a credential fill types the secret itself`
        );
      }
      return { selector };
    }
    if (!isSecretEnvName(field)) {
      throw invalidRequest(
        `fields[${index}].field must name the vault entry to type, such as "PASSWORD"`
      );
    }
    return { selector, field };
  });
  if (isGiven(pageId) && !isNonEmptyString(pageId, MAX_PAGE_ID_BYTES)) {
    throw invalidRequest(`pageId must be a page ID of 1-${MAX_PAGE_ID_BYTES} bytes`);
  }
  if (isGiven(pageUrl) && !isNonEmptyString(pageUrl, MAX_URL_BYTES)) {
    throw invalidRequest(`pageUrl must be a URL or URL prefix of 1-${MAX_URL_BYTES} bytes`);
  }
  if (isGiven(pageId) && isGiven(pageUrl)) {
    throw invalidRequest("Pass pageId or pageUrl, not both");
  }
  if (isGiven(frameUrl) && !isNonEmptyString(frameUrl, MAX_URL_BYTES)) {
    throw invalidRequest(`frameUrl must be a URL or URL prefix of 1-${MAX_URL_BYTES} bytes`);
  }
  return JSON.stringify({
    ...(wireOnePassword
      ? { onePassword: wireOnePassword }
      : withVault
        ? { vault }
        : { credential }),
    fields: wireFields,
    pageId: pageId ?? undefined,
    pageUrl: pageUrl ?? undefined,
    frame: isGiven(frameUrl) ? { url: frameUrl } : undefined,
  });
};

/** Fill secrets attached to a browser session into its pages. */
export class CredentialsService extends BaseService {
  /**
   * Type a secret, a vault's entries, or 1Password fields into inputs on one
   * of the session's pages. A TOTP secret types its current code. Only types;
   * never submits, so click the login button or press Enter afterwards.
   * Values never leave the platform: the result lists an outcome per input.
   * Safe to retry; it is not retried automatically.
   *
   * With `onePassword`, each field's `ref` names the 1Password field, the
   * `op_token` secret must have been attached at session creation as
   * `{ onePassword: name }`, and the request's `allowedOrigins` are the
   * origins the values may be typed on. Each field's result carries the
   * `reference` read, and there is no top-level `version`.
   *
   * API errors are `HyperbrowserError`s whose `details` is the error body; the
   * server's own details are in `details.details`, such as `details.details.pages`
   * for `CREDENTIAL_PAGE_AMBIGUOUS`, or `selectors` and `reasons` (by
   * selector) for `SECRET_ONEPASSWORD_REFERENCE_FAILED`.
   */
  async fill(sessionId: string, params: FillCredentialParams): Promise<CredentialFillResult> {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw invalidRequest("A session ID is required");
    }
    return this.request<CredentialFillResult>(
      `/session/${encodeURIComponent(sessionId)}/credentials/fill`,
      {
        method: "POST",
        body: fillBody(params),
        timeout: Math.max(this.timeout, MIN_FILL_TIMEOUT_MS),
      }
    );
  }
}
