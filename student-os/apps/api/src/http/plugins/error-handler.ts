import type { ErrorCode, ErrorEnvelope } from '@sos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../../platform/errors.js';

/**
 * The single place an error becomes an HTTP response.
 *
 * Rules:
 *   * `AppError` → its own code and status. Intentional, safe to show.
 *   * Validation error → 400 with field-level details.
 *   * Anything else → 500 INTERNAL, full stack logged, nothing leaked. An
 *     unexpected exception is a bug, and its message may contain SQL, file
 *     paths, or connection strings (§50 error sanitisation).
 */

function toEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: { path: string; message: string }[],
): ErrorEnvelope {
  return {
    error: { code, message, requestId, ...(details ? { details } : {}) },
  };
}

/** Fastify and its plugins attach `statusCode` to errors; nothing guarantees it. */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

function zodDetails(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(toEnvelope('NOT_FOUND', 'The requested endpoint was not found.', request.requestId));
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId ?? 'unknown';

    if (isAppError(error)) {
      // Client errors are expected traffic; only log them at debug level so
      // that a wave of 401s does not drown the signal in the error log.
      const level = error.statusCode >= 500 ? 'error' : 'debug';
      request.log[level](
        { err: error, code: error.code, context: error.context },
        'request failed',
      );
      return reply
        .status(error.statusCode)
        .send(toEnvelope(error.code, error.message, requestId, error.details));
    }

    // Request-schema failures raised by the Zod validator compiler. These carry
    // the original ZodIssue, which is what lets the client highlight the exact
    // offending field rather than showing a generic "invalid input".
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((entry) => {
        const issue = entry.params?.issue;
        const path = issue?.path?.join('.') || entry.instancePath.replace(/^\//, '').replace(/\//g, '.');
        return { path: path || '(root)', message: issue?.message ?? entry.message ?? 'invalid' };
      });
      request.log.debug({ details }, 'request validation failed');
      return reply
        .status(400)
        .send(toEnvelope('VALIDATION_ERROR', 'The request payload is invalid.', requestId, details));
    }

    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(
          toEnvelope('VALIDATION_ERROR', 'The request payload is invalid.', requestId, zodDetails(error)),
        );
    }

    // Fastify's own validation failures wrap the ZodError as `cause`.
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof ZodError) {
      return reply
        .status(400)
        .send(
          toEnvelope('VALIDATION_ERROR', 'The request payload is invalid.', requestId, zodDetails(cause)),
        );
    }

    const status = statusCodeOf(error);

    if (status === 429) {
      return reply
        .status(429)
        .send(toEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', requestId));
    }

    if (status === 413) {
      return reply
        .status(413)
        .send(toEnvelope('PAYLOAD_TOO_LARGE', 'The request payload is too large.', requestId));
    }

    if (status !== undefined && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send(toEnvelope('VALIDATION_ERROR', 'The request could not be processed.', requestId));
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(toEnvelope('INTERNAL', 'An unexpected error occurred.', requestId));
  });
}, { name: 'error-handler' });

export { AppError };
