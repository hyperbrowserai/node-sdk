import { invalidRequest } from "../error";
import { checkVaultName, isSecretEnvName } from "../sandbox/secret-references";
import { isPlainObject } from "../secrets-envelope";
import { CredentialFillResult, FillCredentialParams } from "../types/credential";
import { BaseService } from "./base";

const MAX_FIELDS = 16;
const MAX_CREDENTIAL_LENGTH = 255;
const MAX_SELECTOR_BYTES = 1024;
const MAX_PAGE_ID_BYTES = 128;
const MAX_URL_BYTES = 2048;
/** The API gives up on a fill after about 18 seconds. */
const MIN_FILL_TIMEOUT_MS = 30_000;

const isNonEmptyString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes;

const isGiven = (value: unknown): boolean => value !== undefined && value !== null;

const fillBody = (params: FillCredentialParams): string => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Fill parameters must be an object");
  }
  const { credential, vault, fields, pageId, pageUrl, frameUrl } = params;
  const withVault = isGiven(vault);
  if (isGiven(credential) === withVault) {
    throw invalidRequest("Pass exactly one of credential (a secret) and vault");
  }
  if (withVault) {
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
      throw invalidRequest(`fields[${index}] must be a { selector, field? } object`);
    }
    const { selector, field } = entry;
    if (!isNonEmptyString(selector, MAX_SELECTOR_BYTES) || !selector.trim()) {
      throw invalidRequest(
        `fields[${index}].selector must be a CSS selector of 1-${MAX_SELECTOR_BYTES} bytes`
      );
    }
    if (selectors.has(selector)) {
      throw invalidRequest(`fields lists the selector ${selector.slice(0, 64)} more than once`);
    }
    selectors.add(selector);
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
    ...(withVault ? { vault } : { credential }),
    fields: wireFields,
    pageId: pageId ?? undefined,
    pageUrl: pageUrl ?? undefined,
    frame: isGiven(frameUrl) ? { url: frameUrl } : undefined,
  });
};

/** Fill secrets attached to a browser session into its pages. */
export class CredentialsService extends BaseService {
  /**
   * Type a secret, or a vault's entries, into inputs on one of the session's
   * pages. A TOTP secret types its current code. Only types; never submits,
   * so click the login button or press Enter afterwards. Values never leave
   * the platform: the result lists an outcome per input. Safe to retry; it
   * is not retried automatically.
   *
   * API errors are `HyperbrowserError`s whose `details` is the error body; the
   * server's own details are in `details.details`, such as `details.details.pages`
   * for `CREDENTIAL_PAGE_AMBIGUOUS`.
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
