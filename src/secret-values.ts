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

/**
 * The bytes a base32 seed decodes to, read the way the platform reads it:
 * spaces, '-', lowercase and trailing '=' padding are accepted. Undefined
 * when it isn't base32 or has an impossible length.
 */
const base32SeedBytes = (seed: string): number | undefined => {
  const normalized = seed.replace(/[ -]/g, "").toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]+$/.test(normalized) || !BASE32_TAIL_LENGTHS.has(normalized.length % 8)) {
    return undefined;
  }
  return Math.floor((normalized.length * 5) / 8);
};

const isIntegerIn = (text: string, allowed: (value: number) => boolean): boolean =>
  /^[+-]?\d{1,9}$/.test(text) && allowed(Number(text));

/**
 * Check a TOTP seed as the platform will read it at fill or process time; the
 * API can't see values, so a bad seed would otherwise only fail then. Seeds
 * under 10 bytes (16 base32 characters) are accepted, though they are
 * unusually short.
 */
export const checkTotpSeed = (value: string): void => {
  let seed = value.startsWith(BYTE_ORDER_MARK) ? value.slice(1) : value;
  seed = seed.trim();
  if (seed.toLowerCase().startsWith("otpauth://")) {
    // URL parsing would silently drop tabs and newlines.
    if ([...seed].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
      throw invalidSecretValue("A TOTP otpauth:// URI must not contain control characters");
    }
    let url: URL;
    try {
      url = new URL(seed);
    } catch {
      throw invalidSecretValue(INVALID_TOTP);
    }
    if (url.host.toLowerCase() === "hotp") {
      throw invalidSecretValue(
        "HOTP (otpauth://hotp/) is not supported; a TOTP value must be a base32 seed or an otpauth://totp/ URI"
      );
    }
    if (url.protocol !== "otpauth:" || url.host.toLowerCase() !== "totp") {
      throw invalidSecretValue(INVALID_TOTP);
    }
    const algorithm = url.searchParams.get("algorithm");
    const digits = url.searchParams.get("digits");
    const period = url.searchParams.get("period");
    if (
      (algorithm && !TOTP_ALGORITHMS.has(algorithm.toUpperCase())) ||
      (digits && !isIntegerIn(digits, (n) => n === 6 || n === 8)) ||
      (period && !isIntegerIn(period, (n) => n >= 1 && n <= MAX_TOTP_PERIOD_SECONDS))
    ) {
      throw invalidSecretValue(INVALID_TOTP);
    }
    seed = url.searchParams.get("secret") ?? "";
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(seed)) {
    throw invalidSecretValue(INVALID_TOTP);
  }
  const bytes = base32SeedBytes(seed);
  if (bytes === undefined || bytes === 0) {
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
