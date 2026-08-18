import type { FileRef } from '@sos/core';
import type { Visibility } from '@sos/contracts';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * File persistence.
 */

export interface FileRow {
  id: string;
  owner_id: string;
  storage_key: string;
  bucket: string;
  mime_type: string;
  size_bytes: number;
  original_name: string | null;
  metadata: { width?: number; height?: number };
  visibility: Visibility;
  attached_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface InsertFileInput {
  ownerId: string;
  storageKey: string;
  bucket: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  metadata: Record<string, unknown>;
  visibility: Visibility;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
}

export async function insertFile(input: InsertFileInput, client?: Sql): Promise<FileRow> {
  const row = await queryOne<FileRow>(
    `INSERT INTO files (
       owner_id, storage_key, bucket, mime_type, size_bytes, original_name,
       metadata, visibility, university_id, college_id, stage_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, owner_id, storage_key, bucket, mime_type, size_bytes,
               original_name, metadata, visibility, attached_at, created_at, deleted_at`,
    [
      input.ownerId,
      input.storageKey,
      input.bucket,
      input.mimeType,
      input.sizeBytes,
      input.originalName,
      JSON.stringify(input.metadata),
      input.visibility,
      input.universityId,
      input.collegeId,
      input.stageId,
    ],
    client,
  );
  if (!row) throw new Error('insertFile returned no row');
  return row;
}

/**
 * Patches in the real storage key once the bytes are written.
 *
 * The row is inserted before the upload so that a crash mid-write leaves a row
 * with no bytes (which the orphan sweep collects) rather than bytes with no
 * row (which nothing would ever find).
 */
export async function updateStorageKey(
  id: string,
  storageKey: string,
  client?: Sql,
): Promise<FileRow> {
  const row = await queryOne<FileRow>(
    `UPDATE files SET storage_key = $2 WHERE id = $1
     RETURNING id, owner_id, storage_key, bucket, mime_type, size_bytes,
               original_name, metadata, visibility, attached_at, created_at, deleted_at`,
    [id, storageKey],
    client,
  );
  if (!row) throw new Error('updateStorageKey returned no row');
  return row;
}

export async function findFileById(id: string, client?: Sql): Promise<FileRow | null> {
  return queryOne<FileRow>(
    `SELECT id, owner_id, storage_key, bucket, mime_type, size_bytes, original_name,
            metadata, visibility, attached_at, created_at, deleted_at
     FROM files WHERE id = $1`,
    [id],
    client,
  );
}

/** The policy-layer view: placement plus attachment, everything `canAccessFile` needs. */
export async function loadFileRef(id: string, client?: Sql): Promise<FileRef | null> {
  const row = await queryOne<{
    id: string;
    owner_id: string;
    visibility: Visibility;
    course_id: string | null;
    community_id: string | null;
    group_id: string | null;
    classroom_id: string | null;
    college_id: string | null;
    stage_id: string | null;
    university_id: string | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, owner_id, visibility, course_id, community_id, group_id,
            classroom_id, college_id, stage_id, university_id, deleted_at
     FROM files WHERE id = $1`,
    [id],
    client,
  );
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    visibility: row.visibility,
    courseId: row.course_id,
    communityId: row.community_id,
    groupId: row.group_id,
    classroomId: row.classroom_id,
    collegeId: row.college_id,
    stageId: row.stage_id,
    universityId: row.university_id,
    deletedAt: row.deleted_at,
  };
}

/**
 * Claims uploads for a piece of content.
 *
 * Ownership is part of the WHERE clause, not a prior check: a client that sends
 * someone else's file id gets zero rows back rather than attaching a file it
 * does not own. The caller compares the returned count to what it asked for.
 */
export async function attachFilesToContent(
  fileIds: readonly string[],
  ownerId: string,
  context: {
    visibility: Visibility;
    courseId: string | null;
    communityId: string | null;
    groupId: string | null;
  },
  client?: Sql,
): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const rows = await queryRows<{ id: string }>(
    `UPDATE files SET
       attached_at  = now(),
       visibility   = $3,
       course_id    = $4,
       community_id = $5,
       group_id     = $6
     WHERE id = ANY($1::uuid[])
       AND owner_id = $2
       AND deleted_at IS NULL
       AND attached_at IS NULL
     RETURNING id`,
    [
      fileIds,
      ownerId,
      context.visibility,
      context.courseId,
      context.communityId,
      context.groupId,
    ],
    client,
  );
  return rows.map((r) => r.id);
}

/**
 * Claims uploads as a message's attachments.
 *
 * Atomic, like the content path: the same `attached_at IS NULL` predicate means
 * a file cannot be claimed twice, and the caller compares the returned count
 * rather than checking first and hoping.
 *
 * Placement is `private`, which looks wrong until you follow how a recipient
 * actually reaches the bytes. Attachments are served through signed URLs minted
 * **at message-read time, for a reader who has already passed the conversation
 * gate** — the capability model files have used since Phase 2. `private` is
 * therefore the correct placement for the *other* path, `GET /files/:id`, which
 * mints a URL from the file's own visibility: a conversation is not a scope in
 * the visibility vocabulary, and inventing one that `canAccessFile` could not
 * resolve would be a lie in the schema.
 *
 * The consequence, stated so it is not discovered later: a recipient re-mints an
 * expired attachment URL by re-reading the message, not by asking the file
 * endpoint. That is what the client does anyway.
 */
export async function attachFilesToMessage(
  fileIds: readonly string[],
  ownerId: string,
  client?: Sql,
): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const rows = await queryRows<{ id: string }>(
    `UPDATE files SET attached_at = now(), visibility = 'private'
     WHERE id = ANY($1::uuid[])
       AND owner_id = $2
       AND deleted_at IS NULL
       AND attached_at IS NULL
     RETURNING id`,
    [fileIds, ownerId],
    client,
  );
  return rows.map((r) => r.id);
}

/**
 * Marks a file deleted and hands back its storage key, so the caller can
 * free the bytes. Returns `null` when there was nothing to delete — no such
 * file, not owned by this user, or already deleted — so a re-delete never
 * touches storage a second time for a key that may since have been reused.
 */
export async function softDeleteFile(
  id: string,
  ownerId: string,
  client?: Sql,
): Promise<{ storageKey: string } | null> {
  const row = await queryOne<{ storage_key: string }>(
    `UPDATE files SET deleted_at = now()
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
     RETURNING storage_key`,
    [id, ownerId],
    client,
  );
  return row ? { storageKey: row.storage_key } : null;
}

/** Uploads left unattached — the sweep target for abandoned composer sessions. */
export async function listOrphanedFiles(
  olderThanHours: number,
  limit = 500,
  client?: Sql,
): Promise<FileRow[]> {
  return queryRows<FileRow>(
    `SELECT id, owner_id, storage_key, bucket, mime_type, size_bytes, original_name,
            metadata, visibility, attached_at, created_at, deleted_at
     FROM files
     WHERE attached_at IS NULL
       AND deleted_at IS NULL
       AND created_at < now() - make_interval(hours => $1)
     ORDER BY created_at
     LIMIT $2`,
    [olderThanHours, limit],
    client,
  );
}
