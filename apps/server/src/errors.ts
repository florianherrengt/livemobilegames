import type { ErrorCode } from "@phone-party/protocol";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: 400 | 404 | 409 | 429 | 500 | 503;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    status: 400 | 404 | 409 | 429 | 500 | 503,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
