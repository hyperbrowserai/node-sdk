import { invalidSecretValue, secretValueBytes } from "./secrets-envelope";
import { SecretValue } from "./types/secret";

const TOTP_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const MAX_TOTP_PERIOD_SECONDS = 300;
/**
 * Unpadded base32 can't end with 1, 3 or 6 characters of a block. vm-service
 * would silently drop such trailing characters, so a seed copied incompletely
 * would give wrong codes; it is refused instead.
 */
const BASE32_TAIL_LENGTHS = new Set([0, 2, 4, 5, 7]);
const BYTE_ORDER_MARK = "\uFEFF";

const INVALID_TOTP =
  "A TOTP value must be a base32 seed or an otpauth://totp/ URI with a base32 secret, " +
  "and optionally algorithm SHA1, SHA256 or SHA512, digits 6 or 8, and a period of 1 to 300 seconds";

// vm-service parses seeds with Go: these mirror strings.TrimSpace,
// url.Parse and url.ParseQuery, so a value is refused here whenever it would
// be refused there.

/** Go's unicode.IsSpace: ASCII spaces, U+0085, U+00A0 and the Unicode White_Space spaces. */
const GO_SPACE = "\t\n\v\f\r \u0085                 　";

const trimGoSpace = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && GO_SPACE.includes(value[start])) start++;
  while (end > start && GO_SPACE.includes(value[end - 1])) end--;
  return value.slice(start, end);
};

const isHex = (char: string | undefined): boolean =>
  char !== undefined && /^[0-9A-Fa-f]$/.test(char);

/** Every '%' starts a two-digit hex escape, as url.Parse requires outside the query. */
const hasValidEscapes = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%" && !(isHex(text[i + 1]) && isHex(text[i + 2]))) return false;
  }
  return true;
};

/** url.QueryUnescape; undefined for a bad escape. Bytes are read as Latin-1. */
const queryUnescape = (text: string): string | undefined => {
  if (!hasValidEscapes(text)) return undefined;
  return text
    .replace(/\+/g, " ")
    .replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
};

/** url.Values.Get after url.ParseQuery: pairs with bad escapes or ';' are skipped. */
const queryGet = (query: string, key: string): string => {
  for (const pair of query.split("&")) {
    if (!pair || pair.includes(";")) continue;
    const separator = pair.indexOf("=");
    const name = queryUnescape(separator < 0 ? pair : pair.slice(0, separator));
    const value = queryUnescape(separator < 0 ? "" : pair.slice(separator + 1));
    if (name === key && value !== undefined) return value;
  }
  return "";
};

/** Characters url.Parse accepts in the userinfo before '@'. */
const USERINFO_PATTERN = /^[A-Za-z0-9\-._:~!$&'()*+,;=%@]*$/;

/**
 * The otpauth:// URI's query, after the checks url.Parse and vm-service make.
 * `uri` starts with "otpauth://" in any case.
 */
const otpauthQuery = (uri: string): string => {
  if ([...uri].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    throw invalidSecretValue("A TOTP otpauth:// URI must not contain control characters");
  }
  const hash = uri.indexOf("#");
  const fragment = hash < 0 ? "" : uri.slice(hash + 1);
  const beforeFragment = hash < 0 ? uri : uri.slice(0, hash);
  const question = beforeFragment.indexOf("?");
  const query = question < 0 ? "" : beforeFragment.slice(question + 1);
  const rest = (question < 0 ? beforeFragment : beforeFragment.slice(0, question)).slice(
    "otpauth://".length
  );
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash);
  const at = authority.lastIndexOf("@");
  const userinfo = at < 0 ? "" : authority.slice(0, at);
  const host = (at < 0 ? authority : authority.slice(at + 1)).toLowerCase();
  if (!USERINFO_PATTERN.test(userinfo) || ![userinfo, path, fragment].every(hasValidEscapes)) {
    throw invalidSecretValue(INVALID_TOTP);
  }
  if (host === "hotp") {
    throw invalidSecretValue(
      "HOTP (otpauth://hotp/) is not supported; a TOTP value must be a base32 seed or an otpauth://totp/ URI"
    );
  }
  if (host !== "totp") {
    throw invalidSecretValue(INVALID_TOTP);
  }
  return query;
};

/**
 * The bytes a base32 seed decodes to, read the way the platform reads it:
 * spaces, '-', lowercase and trailing '=' padding are accepted. Undefined
 * when it isn't ASCII base32 or has an impossible length.
 */
const base32SeedBytes = (seed: string): number | undefined => {
  const compact = seed.replace(/[ -]/g, "");
  // Checked before uppercasing, which maps characters such as "ß" to ASCII.
  if (!/^[A-Za-z2-7]+=*$/.test(compact)) return undefined;
  const normalized = compact.replace(/=+$/, "");
  return BASE32_TAIL_LENGTHS.has(normalized.length % 8)
    ? Math.floor((normalized.length * 5) / 8)
    : undefined;
};

const isIntegerIn = (text: string, allowed: (value: number) => boolean): boolean =>
  /^[+-]?\d+$/.test(text) && allowed(Number(text));

/**
 * Check a TOTP seed as the platform will read it at fill or process time; the
 * API can't see values, so a bad seed would otherwise only fail then. Seeds
 * under 10 bytes (16 base32 characters) are accepted, though they are
 * unusually short.
 */
export const checkTotpSeed = (value: string): void => {
  let seed = trimGoSpace(value.startsWith(BYTE_ORDER_MARK) ? value.slice(1) : value);
  if (seed.toLowerCase().startsWith("otpauth://")) {
    const query = otpauthQuery(seed);
    const algorithm = queryGet(query, "algorithm");
    const digits = queryGet(query, "digits");
    const period = queryGet(query, "period");
    if (
      (algorithm && !TOTP_ALGORITHMS.has(algorithm.toUpperCase())) ||
      (digits && !isIntegerIn(digits, (n) => n === 6 || n === 8)) ||
      (period && !isIntegerIn(period, (n) => n >= 1 && n <= MAX_TOTP_PERIOD_SECONDS))
    ) {
      throw invalidSecretValue(INVALID_TOTP);
    }
    seed = queryGet(query, "secret");
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(seed)) {
    throw invalidSecretValue(INVALID_TOTP);
  }
  if (base32SeedBytes(seed) === undefined) {
    throw invalidSecretValue(INVALID_TOTP);
  }
};

/**
 * The plaintext stored for a secret of `type`, after the platform's rules
 * for every value (1 byte to 32 KiB of UTF-8, no NUL) and the type's own.
 * Types this SDK doesn't know get the common rules only.
 */
export const secretPlaintext = (type: string, value: SecretValue): Buffer => {
  const bytes = secretValueBytes(value);
  if (type === "totp") {
    checkTotpSeed(bytes.toString("utf8"));
  }
  return bytes;
};
