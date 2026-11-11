export class AuthabError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(args.message);
    this.name = "AuthabError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.requestId = args.requestId;
    Object.setPrototypeOf(this, AuthabError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details,
      requestId: this.requestId,
    };
  }
}

export function isAuthabError(error: unknown): error is AuthabError {
  return error instanceof AuthabError;
}
