/** A secret attached to a browser session, which fill may type into its pages. */
export interface SessionCredential {
  id: string;
  name: string;
}

/**
 * What to attach to a browser session at creation: a secret by name (or
 * `{ secret }`), `{ vault }` for the secrets a vault's entries name, or
 * `{ onePassword }` for an `op_token` secret that fills may read 1Password
 * fields with.
 */
export type SessionCredentialSource =
  | string
  | { secret: string }
  | { vault: string }
  | { onePassword: string };

/**
 * A field of an item in the fill's 1Password vault. Names and IDs are 1-256
 * characters without '/' or '?', and not "." or "..". The field may end
 * with a query such as `?attribute=otp`.
 */
export interface CredentialFillRef {
  /** The item's name or ID. */
  item: string;
  /** The section's name or ID, when the field is in one. */
  section?: string;
  /** The field's name or ID, optionally with a query such as `?attribute=otp`. */
  field: string;
}

/** Which input to fill and, with a vault or 1Password, from which entry or field. */
export interface CredentialFillField {
  /** A CSS selector for the input, 1-1024 UTF-8 bytes. Each selector at most once. */
  selector: string;
  /**
   * The vault entry (its environment variable name, such as `PASSWORD`) to
   * type. Required with `vault`, not allowed otherwise.
   */
  field?: string;
  /** The 1Password field to type. Required with `onePassword`, not allowed otherwise. */
  ref?: CredentialFillRef;
}

/**
 * Fill 1Password fields, read with an `op_token` secret attached to the
 * session. Nothing on the platform says where a 1Password value belongs, so
 * the request names the origins it may be typed on.
 */
export interface CredentialFillOnePassword {
  /** The `op_token` secret attached to the session, by name; its latest version is used. */
  token: string;
  /** The 1Password vault's name or ID. */
  vault: string;
  /**
   * Origins the values may be filled into, 1-20, with the same rules as a
   * secret's: `scheme://host[:port]`, https (http only for localhost), and a
   * leading `*.` matching subdomains of a registrable domain.
   */
  allowedOrigins: string[];
}

export interface FillCredentialParams {
  /** A secret attached to the session, by name or ID. Pass one of this, `vault` or `onePassword`. */
  credential?: string;
  /** A vault attached to the session, by name. Pass one of this, `credential` or `onePassword`. */
  vault?: string;
  /**
   * 1Password fields, each named by its field's `ref`. Pass one of this,
   * `credential` or `vault`.
   */
  onePassword?: CredentialFillOnePassword;
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
  /** The secret typed into this input; for 1Password, the `op_token` secret read with. */
  secretId: string;
  /** Its version. */
  version: number;
  /** The vault entry, for vault fills. */
  field?: string;
  /** The `op://vault/item/[section/]field` reference read, for 1Password fills. */
  reference?: string;
  /** For a TOTP secret, when the code that was typed stops being valid. */
  expiresAt?: string;
}

/** Outcomes per input; never values. */
export interface CredentialFillResult {
  /** The secret version filled, for a single-secret fill. Absent for vault and 1Password fills. */
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
