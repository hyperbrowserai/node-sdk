import fetch, { RequestInit, Response } from "node-fetch";
import { REGIONAL_PROXY_DEV_HOST } from "./config";

const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

function resolveSignedUrlTarget(
  input: string
): { url: string; hostHeader?: string } {
  const url = new URL(input);

  if (!REGIONAL_PROXY_DEV_HOST) {
    return {
      url: url.toString(),
    };
  }

  const override = new URL(
    hasScheme(REGIONAL_PROXY_DEV_HOST)
      ? REGIONAL_PROXY_DEV_HOST
      : `${url.protocol}//${REGIONAL_PROXY_DEV_HOST}`
  );

  const hostHeader = url.host;
  url.protocol = override.protocol;
  url.username = override.username;
  url.password = override.password;
  url.hostname = override.hostname;
  url.port = override.port || url.port;

  return {
    url: url.toString(),
    hostHeader,
  };
}

export async function fetchSignedUrl(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const target = resolveSignedUrlTarget(input);
  const headers: Record<string, string> = {};

  if (init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
    for (const [key, value] of Object.entries(init.headers)) {
      if (value !== undefined) {
        headers[key] = String(value);
      }
    }
  }

  if (target.hostHeader && headers.host === undefined && headers.Host === undefined) {
    headers.Host = target.hostHeader;
  }

  return fetch(target.url, {
    ...init,
    headers,
  });
}
