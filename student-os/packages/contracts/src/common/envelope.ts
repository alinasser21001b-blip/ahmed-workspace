import { z } from 'zod';

/**
 * Error and pagination envelopes.
 *
 * Every non-2xx response in the product has the same shape, and every list
 * endpoint paginates the same way. Clients therefore need exactly one error
 * handler and one pagination hook, not one per endpoint.
 */

/**
 * Stable, machine-readable error codes. Clients branch on `code`, never on
 * `message` — messages are user-facing text and are translated.
 */
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'ACCOUNT_SUSPENDED',
  'PRECONDITION_FAILED',
  'UPSTREAM_ERROR',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Safe for display. Never contains stack traces, SQL, or internal paths. */
    message: z.string(),
    /** Present only for VALIDATION_ERROR. */
    details: z.array(errorIssueSchema).optional(),
    /** Correlates to the server log line for this exact request. */
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Cursor pagination. Offset pagination is deliberately not offered: on a feed
 * that receives writes while a user scrolls, offsets duplicate and skip rows.
 * The cursor is opaque to the client by design so its encoding can change.
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    /** null when there is no further page. */
    nextCursor: z.string().nullable(),
  });
}

export type Paginated<T> = {
  items: T[];
  nextCursor: string | null;
};
