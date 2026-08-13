import type { ReactionKind } from '@sos/contracts';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Comment persistence.
 */

export interface CommentRow {
  id: string;
  content_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  like_count: number;
  reply_count: number;
  is_accepted: boolean;
  edited_at: Date | null;
  created_at: Date;
  author_handle: string;
  author_display_name: string;
  author_avatar_url: string | null;
  author_verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  author_stage_name_ar: string | null;
  author_stage_name_en: string | null;
  author_college_name_ar: string | null;
  author_college_name_en: string | null;
  viewer_reaction: ReactionKind | null;
}

const COMMENT_SELECT = `
  SELECT cm.id, cm.content_id, cm.parent_id, cm.author_id, cm.body,
         cm.like_count, cm.reply_count, cm.is_accepted, cm.edited_at, cm.created_at,
         p.handle       AS author_handle,
         p.display_name AS author_display_name,
         p.avatar_url   AS author_avatar_url,
         u.verification_level AS author_verification_level,
         st.name_ar     AS author_stage_name_ar,
         st.name_en     AS author_stage_name_en,
         co.name_ar     AS author_college_name_ar,
         co.name_en     AS author_college_name_en,
         (SELECT r.kind FROM reactions r
            WHERE r.comment_id = cm.id AND r.user_id = $1::uuid) AS viewer_reaction
  FROM comments cm
  JOIN profiles p ON p.user_id = cm.author_id
  JOIN users u ON u.id = cm.author_id
  LEFT JOIN stages st ON st.id = p.stage_id
  LEFT JOIN colleges co ON co.id = p.college_id
`;

export async function insertComment(
  input: { contentId: string; authorId: string; parentId: string | null; body: string },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO comments (content_id, author_id, parent_id, body)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.contentId, input.authorId, input.parentId, input.body],
    client,
  );
  if (!row) throw new Error('insertComment returned no row');

  // Counters move in the same transaction as the row they summarise, which is
  // the only reason they can be trusted by the feed.
  await queryOne(
    `UPDATE content_items SET comment_count = comment_count + 1 WHERE id = $1`,
    [input.contentId],
    client,
  );
  if (input.parentId) {
    await queryOne(
      `UPDATE comments SET reply_count = reply_count + 1 WHERE id = $1`,
      [input.parentId],
      client,
    );
  }
  return row;
}

export async function findCommentById(
  id: string,
  viewerId: string | null,
  client?: Sql,
): Promise<CommentRow | null> {
  return queryOne<CommentRow>(
    `${COMMENT_SELECT} WHERE cm.id = $2 AND cm.deleted_at IS NULL`,
    [viewerId, id],
    client,
  );
}

/** Raw row for policy decisions — no joins, no viewer state. */
export async function loadCommentOwner(
  id: string,
  client?: Sql,
): Promise<{ id: string; authorId: string; contentId: string; parentId: string | null } | null> {
  const row = await queryOne<{
    id: string;
    author_id: string;
    content_id: string;
    parent_id: string | null;
  }>(
    `SELECT id, author_id, content_id, parent_id FROM comments
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
    client,
  );
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    contentId: row.content_id,
    parentId: row.parent_id,
  };
}

/**
 * Lists top-level comments, newest last so a thread reads in the order it was
 * written. Blocked authors are excluded here rather than after the fetch, so a
 * block does not leave gaps in a page.
 */
export async function listTopLevelComments(
  contentId: string,
  viewerId: string | null,
  excludedUserIds: readonly string[],
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<CommentRow[]> {
  const params: unknown[] = [viewerId, contentId, excludedUserIds, limit + 1];
  let cursorClause = '';
  if (cursor) {
    params.push(new Date(cursor.createdAt), cursor.id);
    cursorClause = `AND (cm.created_at, cm.id) > ($5::timestamptz, $6::uuid)`;
  }

  return queryRows<CommentRow>(
    `${COMMENT_SELECT}
     WHERE cm.content_id = $2
       AND cm.parent_id IS NULL
       AND cm.deleted_at IS NULL
       AND NOT (cm.author_id = ANY($3::uuid[]))
       ${cursorClause}
     ORDER BY cm.created_at, cm.id
     LIMIT $4`,
    params,
    client,
  );
}

/** A bounded preview of replies per parent, so a thread renders in one request. */
export async function listRepliesFor(
  parentIds: readonly string[],
  viewerId: string | null,
  excludedUserIds: readonly string[],
  perParent: number,
  client?: Sql,
): Promise<CommentRow[]> {
  if (parentIds.length === 0) return [];
  return queryRows<CommentRow>(
    `WITH ranked AS (
       SELECT cm.id,
              row_number() OVER (PARTITION BY cm.parent_id ORDER BY cm.created_at) AS rn
       FROM comments cm
       WHERE cm.parent_id = ANY($2::uuid[])
         AND cm.deleted_at IS NULL
         AND NOT (cm.author_id = ANY($3::uuid[]))
     )
     ${COMMENT_SELECT}
     JOIN ranked ON ranked.id = cm.id AND ranked.rn <= $4
     ORDER BY cm.created_at`,
    [viewerId, parentIds, excludedUserIds, perParent],
    client,
  );
}

export async function updateComment(
  id: string,
  authorId: string,
  body: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE comments SET body = $3, edited_at = now()
     WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [id, authorId, body],
    client,
  );
  return row !== null;
}

export async function softDeleteComment(
  id: string,
  contentId: string,
  parentId: string | null,
  client?: Sql,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `UPDATE comments SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
    client,
  );
  if (!row) return;

  await queryOne(
    `UPDATE content_items SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1`,
    [contentId],
    client,
  );
  if (parentId) {
    await queryOne(
      `UPDATE comments SET reply_count = GREATEST(0, reply_count - 1) WHERE id = $1`,
      [parentId],
      client,
    );
  }
}

export async function setCommentReaction(
  commentId: string,
  userId: string,
  kind: ReactionKind,
  client?: Sql,
): Promise<number> {
  const inserted = await queryOne<{ inserted: boolean }>(
    `INSERT INTO reactions (user_id, comment_id, kind)
     VALUES ($2, $1, $3)
     ON CONFLICT (user_id, comment_id) WHERE comment_id IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind
     RETURNING (xmax = 0) AS inserted`,
    [commentId, userId, kind],
    client,
  );
  const row = await queryOne<{ like_count: number }>(
    `UPDATE comments SET like_count = like_count + $2 WHERE id = $1 RETURNING like_count`,
    [commentId, inserted?.inserted ? 1 : 0],
    client,
  );
  return row?.like_count ?? 0;
}

export async function removeCommentReaction(
  commentId: string,
  userId: string,
  client?: Sql,
): Promise<number> {
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM reactions WHERE user_id = $2 AND comment_id = $1 RETURNING id`,
    [commentId, userId],
    client,
  );
  const row = await queryOne<{ like_count: number }>(
    `UPDATE comments SET like_count = GREATEST(0, like_count - $2) WHERE id = $1 RETURNING like_count`,
    [commentId, deleted ? 1 : 0],
    client,
  );
  return row?.like_count ?? 0;
}
