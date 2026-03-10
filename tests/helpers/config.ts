import "../load-env";
import { HyperbrowserClient } from "../../src/client";

export const API_KEY = process.env.HYPERBROWSER_API_KEY || "";
export const BASE_URL = process.env.HYPERBROWSER_BASE_URL || "http://localhost:8080";
export const REGIONAL_PROXY_DEV_HOST = process.env.REGIONAL_PROXY_DEV_HOST || "";
export const DEFAULT_IMAGE_NAME =
  process.env.HYPERBROWSER_DEFAULT_IMAGE_NAME || "node";

export function createClient(): HyperbrowserClient {
  if (!API_KEY) {
    throw new Error("Set HYPERBROWSER_API_KEY in tests/.env before running this script");
  }

  return new HyperbrowserClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });
}

export function testName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
