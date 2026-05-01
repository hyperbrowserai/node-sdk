import { HyperbrowserError } from "../../client";

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const validateCustomApiKeys = (
  useCustomApiKeys: boolean | undefined,
  apiKeys: object | undefined,
  baseUrls: Record<string, string | undefined>
): void => {
  if (useCustomApiKeys && !apiKeys) {
    throw new HyperbrowserError("apiKeys must be provided when useCustomApiKeys is true");
  }

  Object.entries(baseUrls).forEach(([field, value]) => {
    if (value !== undefined && !isAbsoluteHttpUrl(value)) {
      throw new HyperbrowserError(`${field} must be an absolute http or https URL`);
    }
  });
};
