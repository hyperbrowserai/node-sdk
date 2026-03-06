import { expect } from "vitest";
import { HyperbrowserError, type HyperbrowserService } from "../../src/client";

type ExpectedHyperbrowserError = {
  statusCode?: number;
  code?: string;
  service?: HyperbrowserService;
  retryable?: boolean;
  messageIncludes?: string | string[];
  messageIncludesAny?: string[];
  detailsInclude?: string;
};

function normalizeExpectedMessages(
  value: string | string[] | undefined
): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stringifyDetails(details: unknown): string {
  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function serializeHyperbrowserError(error: HyperbrowserError) {
  return {
    message: error.message,
    statusCode: error.statusCode,
    code: error.code,
    requestId: error.requestId,
    retryable: error.retryable,
    service: error.service,
    details: error.details,
  };
}

export async function expectHyperbrowserError(
  label: string,
  action: () => Promise<unknown>,
  expected: ExpectedHyperbrowserError = {}
): Promise<HyperbrowserError> {
  try {
    await action();
  } catch (error) {
    expect(error, `${label}: expected HyperbrowserError`).toBeInstanceOf(
      HyperbrowserError
    );

    const sdkError = error as HyperbrowserError;

    expect(
      /\bUnknown (error occurred|runtime request error)\b/i.test(
        sdkError.message
      ),
      `${label}: expected structured SDK error, got generic message ${JSON.stringify(
        sdkError.message
      )}`
    ).toBe(false);

    if (expected.statusCode !== undefined) {
      expect(sdkError.statusCode, `${label}: unexpected statusCode`).toBe(
        expected.statusCode
      );
    }
    if (expected.code !== undefined) {
      expect(sdkError.code, `${label}: unexpected code`).toBe(expected.code);
    }
    if (expected.service !== undefined) {
      expect(sdkError.service, `${label}: unexpected service`).toBe(
        expected.service
      );
    }
    if (expected.retryable !== undefined) {
      expect(sdkError.retryable, `${label}: unexpected retryable flag`).toBe(
        expected.retryable
      );
    }

    for (const text of normalizeExpectedMessages(expected.messageIncludes)) {
      expect(sdkError.message, `${label}: unexpected error message`).toContain(
        text
      );
    }

    if (expected.messageIncludesAny && expected.messageIncludesAny.length > 0) {
      expect(
        expected.messageIncludesAny.some((text) => sdkError.message.includes(text)),
        `${label}: expected error message to include one of ${expected.messageIncludesAny
          .map((text) => JSON.stringify(text))
          .join(", ")}, got ${JSON.stringify(sdkError.message)}`
      ).toBe(true);
    }

    if (expected.detailsInclude !== undefined) {
      expect(
        stringifyDetails(sdkError.details),
        `${label}: unexpected error details`
      ).toContain(expected.detailsInclude);
    }

    return sdkError;
  }

  throw new Error(`${label}: expected HyperbrowserError, but call succeeded`);
}
