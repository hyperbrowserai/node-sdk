import { invalidRequest } from "../error";
import { CREDENTIAL_FIELD_PATTERN, isPlainObject } from "../secrets-envelope";
import { CredentialFillResult, FillCredentialParams } from "../types/credential";
import { BaseService } from "./base";

const MAX_FIELDS = 16;
const MAX_SELECTOR_BYTES = 1024;
const MAX_PAGE_ID_BYTES = 128;
const MAX_FRAME_URL_BYTES = 2048;
/** The API gives up on a fill after about 18 seconds. */
const MIN_FILL_TIMEOUT_MS = 30_000;

const isNonEmptyString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes;

const fillBody = (params: FillCredentialParams): string => {
  if (!isPlainObject(params)) {
    throw invalidRequest("Fill parameters must be an object");
  }
  const { credential, fields, pageId, frame } = params;
  if (typeof credential !== "string" || !credential.trim()) {
    throw invalidRequest("credential must be the name or ID of a credential");
  }
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_FIELDS) {
    throw invalidRequest(`fields must list 1-${MAX_FIELDS} { field, selector } pairs`);
  }
  const seen = new Set<string>();
  const wireFields = fields.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw invalidRequest(`fields[${index}] must be a { field, selector } object`);
    }
    const { field, selector } = entry;
    if (typeof field !== "string" || !CREDENTIAL_FIELD_PATTERN.test(field)) {
      throw invalidRequest(`fields[${index}].field must be 1-64 letters, digits, '_', '.' or '-'`);
    }
    if (seen.has(field)) {
      throw invalidRequest(`fields lists ${field} more than once`);
    }
    seen.add(field);
    if (!isNonEmptyString(selector, MAX_SELECTOR_BYTES) || !selector.trim()) {
      throw invalidRequest(
        `fields[${index}].selector must be a CSS selector of 1-${MAX_SELECTOR_BYTES} bytes`
      );
    }
    return { field, selector };
  });
  if (pageId !== undefined && pageId !== null && !isNonEmptyString(pageId, MAX_PAGE_ID_BYTES)) {
    throw invalidRequest(`pageId must be a page ID of 1-${MAX_PAGE_ID_BYTES} bytes`);
  }
  let wireFrame: { url: string } | undefined;
  if (frame !== undefined && frame !== null) {
    if (!isPlainObject(frame) || !isNonEmptyString(frame.url, MAX_FRAME_URL_BYTES)) {
      throw invalidRequest(
        `frame.url must be a URL or URL prefix of 1-${MAX_FRAME_URL_BYTES} bytes`
      );
    }
    wireFrame = { url: frame.url };
  }
  return JSON.stringify({
    credential,
    fields: wireFields,
    pageId: pageId ?? undefined,
    frame: wireFrame,
  });
};

/** Fill credentials attached to a browser session into its pages. */
export class CredentialsService extends BaseService {
  /**
   * Type a stored credential's fields into inputs on one of the session's
   * pages. Only types; never submits, so click the login button or press
   * Enter afterwards. Values never leave the platform: the result lists an
   * outcome per field. Safe to retry; it is not retried automatically.
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
