export interface ControlAuthErrorOptions {
  statusCode?: number;
  code?: string;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class ControlAuthError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly retryable: boolean;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  constructor(message: string, options: ControlAuthErrorOptions = {}) {
    super(message);
    this.name = "ControlAuthError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}
