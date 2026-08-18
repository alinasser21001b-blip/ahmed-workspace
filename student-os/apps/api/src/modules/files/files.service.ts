import { randomUUID } from 'node:crypto';
import type { FileRef as FileRefDto, Visibility } from '@sos/contracts';
import { MAX_IMAGE_BYTES } from '@sos/contracts';
import { canAccessFile, type Actor } from '@sos/core';
import { getConfig } from '../../platform/config.js';
import { errors } from '../../platform/errors.js';
import { sniffImage } from '../../platform/image-meta.js';
import { sanitizeImage } from '../../platform/image-sanitize.js';
import { getLogger } from '../../platform/logger.js';
import { buildStorageKey, EXTENSION_BY_MIME, getStorage } from '../../platform/storage.js';
import * as profiles from '../users/users.repository.js';
import * as repo from './files.repository.js';
import { signMediaUrl } from './signed-url.js';

/**
 * File business logic.
 */

export function toFileRefDto(row: repo.FileRow): FileRefDto {
  const signed = signMediaUrl(row.id);
  return {
    id: row.id,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.metadata.width ?? null,
    height: row.metadata.height ?? null,
    url: signed.url,
    expiresAt: signed.expiresAt,
  };
}

/**
 * Accepts an upload.
 *
 * The declared content type is ignored entirely. The format is read from the
 * leading bytes, and a file whose bytes are not a supported image is refused —
 * a `.png` extension and an `image/png` header are both client claims.
 *
 * Uploads land unattached and owner-only. They become visible to anyone else
 * only when a post claims them, which means an upload that never gets posted
 * never becomes readable.
 */
export async function uploadImage(
  actor: Actor,
  input: { buffer: Buffer; originalName: string | null; declaredMime: string },
): Promise<FileRefDto> {
  if (input.buffer.length === 0) {
    throw errors.validation([{ path: 'file', message: 'The uploaded file is empty.' }]);
  }
  if (input.buffer.length > MAX_IMAGE_BYTES) {
    throw errors.payloadTooLarge(MAX_IMAGE_BYTES);
  }

  const meta = sniffImage(input.buffer);
  if (!meta) {
    throw errors.unsupportedMediaType(input.declaredMime);
  }

  const extension = EXTENSION_BY_MIME[meta.mimeType];
  if (!extension) throw errors.unsupportedMediaType(meta.mimeType);

  /*
   * Metadata sanitization (App Store readiness — 5.1.1 privacy). A phone
   * photo's EXIF block carries GPS coordinates by default, and nothing before
   * this point ever looked past the format signature. `sanitizeImage` strips
   * GPS and every other non-essential metadata field at the container level —
   * never by decoding pixels — and rebuilds a minimal orientation-only EXIF
   * block for JPEG so the image still displays right-side up.
   *
   * The sanitized bytes are re-sniffed rather than trusted: sanitisation only
   * touches header/metadata segments and never the pixel data, so dimensions
   * cannot legitimately change. If they did — meaning the format is no longer
   * parseable — that is treated as a sanitizer bug, not a reason to fall back
   * to the unsanitized original, which would silently reopen the privacy hole
   * this exists to close.
   */
  const sanitized = sanitizeImage(input.buffer, meta.mimeType);
  const sanitizedMeta = sniffImage(sanitized.buffer);
  if (!sanitizedMeta || sanitizedMeta.width !== meta.width || sanitizedMeta.height !== meta.height) {
    throw errors.unsupportedMediaType(meta.mimeType);
  }
  const bytes = sanitized.buffer;

  const profile = await profiles.findProfileByUserId(actor.userId);
  const storage = getStorage();
  const { env } = getConfig();

  // The id is minted by the database, but the key needs it, so the row is
  // written first and the key patched. Writing bytes before the row would leave
  // orphaned blobs on any failure; writing the row first leaves at worst a row
  // with no bytes, which the orphan sweep already covers.
  const row = await repo.insertFile({
    ownerId: actor.userId,
    storageKey: `pending/${randomUUID()}`,
    bucket: env.STORAGE_BUCKET ?? 'local',
    mimeType: meta.mimeType,
    sizeBytes: bytes.length,
    originalName: input.originalName,
    metadata: { width: meta.width, height: meta.height },
    visibility: 'private',
    universityId: profile?.university_id ?? null,
    collegeId: profile?.college_id ?? null,
    stageId: profile?.stage_id ?? null,
  });

  const key = buildStorageKey(actor.userId, row.id, extension);
  await storage.put(key, bytes, meta.mimeType);

  const stored = await repo.updateStorageKey(row.id, key);
  return toFileRefDto(stored);
}

/**
 * Resolves the bytes behind a signed URL.
 *
 * The signature is checked by the route before this runs. This second check —
 * that the file still exists and is not deleted — is what stops a URL minted
 * before a deletion from continuing to serve the content for the rest of its
 * window.
 */
export async function readFileBytes(
  fileId: string,
): Promise<{ body: Buffer; mimeType: string; sizeBytes: number }> {
  const row = await repo.findFileById(fileId);
  if (!row || row.deleted_at !== null) throw errors.notFound('file');

  const body = await getStorage().get(row.storage_key);
  return { body, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) };
}

/**
 * Mints a signed URL after an explicit policy check.
 *
 * This is the only place a URL is handed out for a file the caller does not
 * own, and it is the moment the authorization decision is made.
 */
export async function mintSignedUrl(actor: Actor, fileId: string): Promise<FileRefDto> {
  const ref = await repo.loadFileRef(fileId);
  if (!ref) throw errors.notFound('file');
  if (!canAccessFile(actor, ref).allowed) throw errors.notFound('file');

  const row = await repo.findFileById(fileId);
  if (!row) throw errors.notFound('file');
  return toFileRefDto(row);
}

/**
 * Claims uploads for a piece of content, inheriting its visibility.
 *
 * Refuses the whole operation if any id fails to attach — a partial attach
 * would publish a post referencing media the author does not own, or media
 * already used elsewhere.
 */
export async function attachToContent(
  fileIds: readonly string[],
  ownerId: string,
  context: {
    visibility: Visibility;
    courseId: string | null;
    communityId: string | null;
    groupId: string | null;
  },
  client?: Parameters<typeof repo.attachFilesToContent>[3],
): Promise<void> {
  if (fileIds.length === 0) return;

  const attached = await repo.attachFilesToContent(fileIds, ownerId, context, client);
  if (attached.length !== new Set(fileIds).size) {
    throw errors.preconditionFailed(
      'One or more attachments are unavailable, already in use, or not yours.',
      { field: 'mediaFileIds' },
    );
  }
}

/**
 * Deletes a file the caller owns — the row and the bytes both.
 *
 * The row goes first, and the storage delete happens after, outside any
 * transaction: an object delete cannot be rolled back, so doing it before
 * the row is confirmed gone risks freeing bytes a failed request still
 * references. If the storage delete itself fails, that is logged rather
 * than thrown — the row is already gone, so the file is deleted from the
 * caller's point of view regardless, and turning a storage hiccup into a
 * 500 for an operation that otherwise fully succeeded would be wrong.
 */
export async function deleteOwnFile(actor: Actor, fileId: string): Promise<void> {
  const deleted = await repo.softDeleteFile(fileId, actor.userId);
  if (!deleted) throw errors.notFound('file');

  try {
    await getStorage().delete(deleted.storageKey);
  } catch (error) {
    getLogger().error(
      { err: error, fileId, storageKey: deleted.storageKey },
      'storage object survived a file delete',
    );
  }
}
