import { z } from 'zod';
import { uuidSchema, visibilitySchema } from '../common/primitives.js';

/**
 * File contract.
 *
 * Uploads go through the API rather than direct-to-storage in V1. The trade is
 * deliberate: the server sees the bytes, so MIME sniffing, size enforcement and
 * (later) malware scanning happen in one place that a client cannot bypass. The
 * cost is API bandwidth, which is irrelevant at cohort scale and is the
 * documented seam for moving to presigned direct upload.
 */

/** The image types V1 accepts. Validated by magic bytes, never by the client's claim. */
export const imageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export type ImageMime = z.infer<typeof imageMimeSchema>;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_PER_POST = 4;

export const fileRefSchema = z.object({
  id: uuidSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /**
   * Short-lived signed URL. A signed URL is a bearer capability by nature — the
   * authorization decision happens when it is minted, and the short expiry
   * bounds the damage if one leaks. Never treat its presence as proof of
   * ongoing access.
   */
  url: z.string(),
  expiresAt: z.string(),
});
export type FileRef = z.infer<typeof fileRefSchema>;

export const uploadFileResponseSchema = fileRefSchema;

export const fileVisibilityQuerySchema = z.object({
  visibility: visibilitySchema.default('stage'),
});
