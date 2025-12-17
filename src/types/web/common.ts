import { z } from "zod";
import { FetchPageStatus, FetchWaitUntil, FetchScreenshotFormat } from "../constants";

export interface WebScreenshotOutputOptions {
  fullPage?: boolean;
  format?: FetchScreenshotFormat;
  cropToContent?: boolean;
  cropToContentMaxHeight?: number;
  cropToContentMinHeight?: number;
  waitFor?: number;
}

export interface WebStorageStateOptions {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

export interface FetchOptions {
  includeTags?: string[];
  excludeTags?: string[];
  sanitize?: boolean;
  waitFor?: number;
  timeout?: number;
  waitUntil?: FetchWaitUntil;
  storageState?: WebStorageStateOptions;
}

export interface FetchedPage {
  url: string;
  status: FetchPageStatus;
  error?: string | null;
  metadata?: Record<string, string | string[]>;
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  json?: object;
}

export type WebOutputOptions =
  | {
      options?: object;
      type: "markdown";
    }
  | {
      options?: object;
      type: "html";
    }
  | {
      options?: object;
      type: "links";
    }
  | {
      options?: WebScreenshotOutputOptions;
      type: "screenshot";
    }
  | {
      options: {
        schema?: z.ZodSchema | object;
      };
      type: "json";
    }
  | "markdown"
  | "html"
  | "links"
  | "screenshot";
