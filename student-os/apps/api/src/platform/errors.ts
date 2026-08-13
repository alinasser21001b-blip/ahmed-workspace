import type { ErrorCode } from '@sos/contracts';

/**
 * Error taxonomy.
 *
 * Two rules make this worth having:
 *   1. Every failure the API produces on purpose is an `AppError` with a stable
 *      code the client can branch on.
 *   2. Anything else is a bug, is logged with its stack, and is returned to the
 *      client as a bare INTERNAL. Error sanitisation is a security control
 *      (§50): stack traces and SQL fragments are a map of the system.
 */

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: { path: string; message: string }[];
  /** Structured context for the log line only. Never serialised to the client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    options: {
      details?: { path: string; message: string }[];
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    if (options.details) this.details = options.details;
    if (options.context) this.context = options.context;
  }
}

export const errors = {
  validation: (details: { path: string; message: string }[]) =>
    new AppError('VALIDATION_ERROR', 400, 'The request payload is invalid.', { details }),

  unauthenticated: (reason = 'authentication_required') =>
    new AppError('UNAUTHENTICATED', 401, 'Authentication is required.', {
      context: { reason },
    }),

  /**
   * Authorization failure. The message is deliberately uniform: telling an
   * unauthorised caller *why* they were refused ("not a member of group X")
   * confirms that X exists and that they are not in it.
   */
  forbidden: (reason = 'forbidden', context: Record<string, unknown> = {}) =>
    new AppError('FORBIDDEN', 403, 'You do not have access to this resource.', {
      context: { reason, ...context },
    }),

  /**
   * Used for resources that exist but the caller cannot see. Preferring 404
   * over 403 in that case avoids leaking existence; the choice between them is
   * made by the service, not here.
   */
  notFound: (resource = 'resource') =>
    new AppError('NOT_FOUND', 404, 'The requested resource was not found.', {
      context: { resource },
    }),

  conflict: (message: string, context: Record<string, unknown> = {}) =>
    new AppError('CONFLICT', 409, message, { context }),

  accountSuspended: (status: string) =>
    new AppError('ACCOUNT_SUSPENDED', 403, 'This account is not permitted to perform that action.', {
      context: { status },
    }),

  rateLimited: () =>
    new AppError('RATE_LIMITED', 429, 'Too many requests. Please slow down.'),

  payloadTooLarge: (limitBytes: number) =>
    new AppError('PAYLOAD_TOO_LARGE', 413, 'The uploaded file is too large.', {
      context: { limitBytes },
    }),

  unsupportedMediaType: (mime: string) =>
    new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'That file type is not supported.', {
      context: { mime },
    }),

  preconditionFailed: (message: string, context: Record<string, unknown> = {}) =>
    new AppError('PRECONDITION_FAILED', 412, message, { context }),

  upstream: (service: string, cause?: unknown) =>
    new AppError('UPSTREAM_ERROR', 502, 'An upstream service failed.', {
      context: { service },
      cause,
    }),

  internal: (cause?: unknown) =>
    new AppError('INTERNAL', 500, 'An unexpected error occurred.', { cause }),
} as const;

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Postgres unique-violation code, used to convert races into CONFLICT. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
