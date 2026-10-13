/** A credential attached to a browser session. */
export interface SessionCredential {
  id: string;
  name: string;
}

/** Which stored field to type into which input. */
export interface CredentialFillField {
  /** A key of the credential's value, such as `username`; `^[a-zA-Z0-9_.-]{1,64}$`. */
  field: string;
  /** A CSS selector for the input, 1-1024 UTF-8 bytes. */
  selector: string;
}

export interface FillCredentialParams {
  /** The credential's name (or ID); it must be attached to the session. */
  credential: string;
  /** 1-16 fields, each field name at most once. */
  fields: CredentialFillField[];
  /**
   * The tab to fill (a CDP target ID). Needed when several tabs could be the
   * target; see `CREDENTIAL_PAGE_AMBIGUOUS`.
   */
  pageId?: string;
  /** Fill inside the iframe whose URL starts with `url`. */
  frame?: { url: string };
}

/**
 * - `filled`: the input holds exactly the value.
 * - `not_found`: no input matched the selector.
 * - `ambiguous`: several visible inputs matched.
 * - `not_editable`: disabled, read-only, hidden or not a text input.
 * - `not_accepted`: the page didn't keep the value (for example `maxlength`).
 * - `not_populated`: the stored value has no such field.
 */
export type CredentialFillOutcome =
  | "filled"
  | "not_found"
  | "ambiguous"
  | "not_editable"
  | "not_accepted"
  | "not_populated"
  | (string & {});

export interface CredentialFillFieldResult {
  field: string;
  outcome: CredentialFillOutcome;
}

/** Outcomes per field; never values. */
export interface CredentialFillResult {
  /** The credential version that was filled. */
  version: number;
  pageId?: string;
  origin?: string;
  fields: CredentialFillFieldResult[];
}

/** One candidate tab in a `CREDENTIAL_PAGE_AMBIGUOUS` error's `details.pages`. */
export interface CredentialFillPage {
  pageId: string;
  url: string;
  title: string;
}
