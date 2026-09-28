export type HyperbrowserService = "control" | "runtime";

export interface HyperbrowserErrorOptions {
  statusCode?: number;
  code?: string;
  requestId?: string;
  retryable?: boolean;
  service?: HyperbrowserService;
  details?: unknown;
  cause?: unknown;
  method?: string;
  path?: string;
}

export class HyperbrowserError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly retryable: boolean;
  public readonly service?: HyperbrowserService;
  public readonly details?: unknown;
  public readonly cause?: unknown;
  public readonly method?: string;
  public readonly path?: string;

  constructor(message: string, options: number | HyperbrowserErrorOptions = {}) {
    super(`[Hyperbrowser]: ${message}`);
    this.name = "HyperbrowserError";

    const normalized = typeof options === "number" ? { statusCode: options } : options;

    this.statusCode = normalized.statusCode;
    this.code = normalized.code;
    this.requestId = normalized.requestId;
    this.retryable = normalized.retryable ?? false;
    this.service = normalized.service;
    this.details = normalized.details;
    this.cause = normalized.cause;
    this.method = normalized.method;
    this.path = normalized.path;
  }
}
