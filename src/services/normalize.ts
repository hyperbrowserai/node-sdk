import { HyperbrowserError } from "../error";

/** Nullable numeric wire values used by sandbox and volume endpoints. */
export const optionalNumber = (value: unknown, integer = false): number | null | undefined => {
  if (value === undefined || value === null) return value;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isFinite(parsed) ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new HyperbrowserError("Invalid numeric value in API response", { service: "control" });
  }
  return parsed;
};
export const optionalInteger = (value: unknown): number | null | undefined =>
  optionalNumber(value, true);
