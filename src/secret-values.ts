import { invalidSecretValue, secretValueBytes } from "./secrets-envelope";
import { SecretValue } from "./types/secret";

/** Seeds shorter than this (80 bits) are weak; RFC 4226 recommends 160. */
const MIN_RECOMMENDED_TOTP_SEED_BYTES = 10;
const TOTP_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const MAX_TOTP_PERIOD_SECONDS = 300;
/** Unpadded base32 can't end with 1, 3 or 6 characters of a block. */
const BASE32_TAIL_LENGTHS = new Set([0, 2, 4, 5, 7]);
const BYTE_ORDER_MARK = "﻿";

const INVALID_TOTP =
  "A TOTP value must be a base32 seed or an otpauth://totp/ URI with a base32 secret, " +
  "and optionally algorithm SHA1, SHA256 or SHA512, digits 6 or 8, and a period of 1 to 300 seconds";

/**
 * The bytes a base32 seed decodes to, read the way the platform reads it:
 * spaces, '-', lowercase and trailing '=' padding are accepted. Undefined
 * when it isn't base32.
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
 * API can't see values, so a bad seed would otherwise only fail then. Short
 * seeds are accepted with a process warning.
 */
export const checkTotpSeed = (value: string): void => {
  let seed = value.startsWith(BYTE_ORDER_MARK) ? value.slice(1) : value;
  seed = seed.trim();
  if (seed.toLowerCase().startsWith("otpauth://")) {
    let url: URL;
    try {
      url = new URL(seed);
    } catch {
      throw invalidSecretValue(INVALID_TOTP);
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
  }
  const bytes = base32SeedBytes(seed);
  if (bytes === undefined || bytes === 0) {
    throw invalidSecretValue(INVALID_TOTP);
  }
  if (bytes < MIN_RECOMMENDED_TOTP_SEED_BYTES) {
    process.emitWarning(
      `The TOTP seed is ${bytes} bytes; seeds are usually at least ${MIN_RECOMMENDED_TOTP_SEED_BYTES} (16 base32 characters). Check that it was copied whole.`,
      { code: "HYPERBROWSER_TOTP_SEED_SHORT" }
    );
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
