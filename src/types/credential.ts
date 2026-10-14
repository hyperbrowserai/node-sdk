/** A secret attached to a browser session, which fill may type into its pages. */
export interface SessionCredential {
  id: string;
  name: string;
}

/**
 * What to attach to a browser session at creation: a secret by name (or
 * `{ secret }`), or `{ vault }` for the secrets a stored vault's entries name.
 */
export type SessionCredentialSource = string | { secret: string } | { vault: string };

/** Which input to fill and, with a vault, from which entry. */
export interface CredentialFillField {
  /** A CSS selector for the input, 1-1024 UTF-8 bytes. Each selector at most once. */
  selector: string;
  /**
   * The vault entry (its environment variable name, such as `PASSWORD`) to
   * type. Required with `vault`, not allowed with `credential`.
   */
  field?: string;
}

export interface FillCredentialParams {
  /** A secret attached to the session, by name or ID. Pass this or `vault`. */
  credential?: string;
  /** A vault attached to the session, by name. Pass this or `credential`. */
  vault?: string;
  /** 1-16 inputs. */
  fields: CredentialFillField[];
  /**
   * The tab to fill (a CDP target ID). Needed when several tabs could be the
   * target; see `CREDENTIAL_PAGE_AMBIGUOUS`. Not with `pageUrl`.
   */
  pageId?: string;
  /** Fill the tab whose URL starts with this. Not with `pageId`. */
  pageUrl?: string;
  /** Fill inside the iframe whose URL starts with this. */
  frameUrl?: string;
}

/**
 * - `filled`: the input holds the value (for a TOTP secret, the current code).
 * - `not_found`: no input matched the selector.
 * - `ambiguous`: several visible inputs matched.
 * - `not_editable`: disabled, read-only, hidden or not a text input.
 * - `not_accepted`: the page didn't keep the value (for example `maxlength`).
 *
 * Outcomes added later come through as other strings.
 */
export type CredentialFillOutcome =
  | "filled"
  | "not_found"
  | "ambiguous"
  | "not_editable"
  | "not_accepted"
  | (string & {});

export interface CredentialFillFieldResult {
  selector: string;
  outcome: CredentialFillOutcome;
  /** The secret typed into this input. */
  secretId: string;
  /** Its version. */
  version: number;
  /** The vault entry, for vault fills. */
  field?: string;
  /** For a TOTP secret, when the code that was typed stops being valid. */
  expiresAt?: string;
}

/** Outcomes per input; never values. */
export interface CredentialFillResult {
  /** The secret version filled, for a single-secret fill. */
  version?: number;
  pageId: string;
  origin: string;
  fields: CredentialFillFieldResult[];
}

/** One candidate tab in a `CREDENTIAL_PAGE_AMBIGUOUS` error's `details.pages`. */
export interface CredentialFillPage {
  pageId: string;
  url: string;
  title: string;
}
