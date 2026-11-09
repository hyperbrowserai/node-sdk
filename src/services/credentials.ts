import { invalidRequest } from "../error";
import { serializeOnePasswordToken } from "../sandbox/secret-references";
import { isPlainObject } from "../secrets-envelope";
import { CredentialFillResult, FillCredentialParams } from "../types/credential";
import { BaseService } from "./base";

/** The API gives up on a fill after about 18 seconds. */
const MIN_FILL_TIMEOUT_MS = 30_000;

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
   * `reference` read, and there is no top-level `version`. A
   * customer-protected token is passed as `secrets.unwrap()` returns it.
   *
   * A `vault` fill needs the vault attached to the session; it fills the
   * entries as they are now. Customer-protected secrets can't be filled.
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
    if (!isPlainObject(params)) {
      throw invalidRequest("Fill parameters must be an object");
    }
    if ("frame" in params) {
      throw invalidRequest("Use frameUrl to select an iframe");
    }
    // Preserve request members so the API can reject unknown or conflicting options.
    const { frameUrl, ...body } = params;
    const onePassword = isPlainObject(body.onePassword)
      ? { ...body.onePassword, token: serializeOnePasswordToken(body.onePassword.token) }
      : body.onePassword;
    return this.request<CredentialFillResult>(
      `/session/${encodeURIComponent(sessionId)}/credentials/fill`,
      {
        method: "POST",
        body: JSON.stringify({
          ...body,
          onePassword,
          frame: frameUrl == null ? undefined : { url: frameUrl },
        }),
        timeout: Math.max(this.timeout, MIN_FILL_TIMEOUT_MS),
      }
    );
  }
}
