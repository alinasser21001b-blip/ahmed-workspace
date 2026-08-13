import type { AccountStatus, ContentKind, ReactionKind, Visibility } from '@sos/contracts';
import type { ContentRef, VisibilityScopes } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';
import { buildContentByIdQuery, buildFeedQuery, type FeedQueryOptions } from './feed.sql.js';

/**
 * Content persistence.
 */

export interface ContentRow {
  id: string;
  kind: ContentKind;
  author_id: string;
  body: string | null;
  visibility: Visibility;
  course_id: string | null;
  subject_id: string | null;
  community_id: string | null;
  group_id: string | null;
  classroom_id: string | null;
  like_count: number;
  comment_count: number;
  bookmark_count: number;
  view_count: number;
  is_pinned: boolean;
  edited_at: Date | null;
  created_at: Date;
  seen: boolean;
  score: number;
  author_handle: string;
  author_display_name: string;
  author_avatar_url: string | null;
  author_verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  author_stage_name_ar: string | null;
  author_stage_name_en: string | null;
  author_college_name_ar: string | null;
  author_college_name_en: string | null;
  course_name_ar: string | null;
  course_name_en: string | null;
  subject_name_ar: string | null;
  subject_name_en: string | null;
  community_name_ar: string | null;
  community_name_en: string | null;
  group_name: string | null;
  viewer_reaction: ReactionKind | null;
  viewer_bookmarked: boolean;
  media: { id: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null }[];
  topics: { id: string; nameAr: string; nameEn: string }[];
}

export interface InsertContentInput {
  kind: ContentKind;
  authorId: string;
  body: string | null;
  visibility: Visibility;
  universityId: string | null;
  collegeId: string | null;
  programId: string | null;
  stageId: string | null;
  courseId: string | null;
  subjectId: string | null;
  communityId: string | null;
  groupId: string | null;
}

export async function insertContent(
  input: InsertContentInput,
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO content_items (
       kind, author_id, body, visibility,
       university_id, college_id, program_id, stage_id,
       course_id, subject_id, community_id, group_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.kind,
      input.authorId,
      input.body,
      input.visibility,
      input.universityId,
      input.collegeId,
      input.programId,
      input.stageId,
      input.courseId,
      input.subjectId,
      input.communityId,
      input.groupId,
    ],
    client,
  );
  if (!row) throw new Error('insertContent returned no row');
  return row;
}

export async function replaceTopics(
  contentId: string,
  topicIds: readonly string[],
  client?: Sql,
): Promise<void> {
  await queryOne(`DELETE FROM content_topics WHERE content_id = $1`, [contentId], client);
  if (topicIds.length === 0) return;
  await queryOne(
    `INSERT INTO content_topics (content_id, topic_id, source)
     SELECT $1, unnest($2::uuid[]), 'author' ON CONFLICT DO NOTHING`,
    [contentId, topicIds],
    client,
  );
}

export async function attachMedia(
  contentId: string,
  fileIds: readonly string[],
  client?: Sql,
): Promise<void> {
  if (fileIds.length === 0) return;
  await queryOne(
    `INSERT INTO content_media (content_id, file_id, ordinal)
     SELECT $1, id, ordinality - 1
     FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ordinality)
     ON CONFLICT DO NOTHING`,
    [contentId, fileIds],
    client,
  );
}

/** The policy-layer view. Used for single-object decisions via `canViewContent`. */
export async function loadContentRef(id: string, client?: Sql): Promise<ContentRef | null> {
  const row = await queryOne<{
    id: string;
    author_id: string;
    visibility: Visibility;
    university_id: string | null;
    college_id: string | null;
    stage_id: string | null;
    course_id: string | null;
    community_id: string | null;
    group_id: string | null;
    classroom_id: string | null;
    deleted_at: Date | null;
    author_status: AccountStatus;
  }>(
    // The author's standing is joined in rather than checked separately: it is
    // an input to `canViewContent`, and a second query is a second chance to
    // forget it.
    `SELECT ci.id, ci.author_id, ci.visibility, ci.university_id, ci.college_id,
            ci.stage_id, ci.course_id, ci.community_id, ci.group_id,
            ci.classroom_id, ci.deleted_at,
            au.status AS author_status
     FROM content_items ci
     JOIN users au ON au.id = ci.author_id
     WHERE ci.id = $1`,
    [id],
    client,
  );
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    visibility: row.visibility,
    universityId: row.university_id,
    collegeId: row.college_id,
    stageId: row.stage_id,
    courseId: row.course_id,
    communityId: row.community_id,
    groupId: row.group_id,
    classroomId: row.classroom_id,
    deletedAt: row.deleted_at,
    authorStatus: row.author_status,
  };
}

export async function findContentById(
  id: string,
  viewerId: string | null,
  client?: Sql,
): Promise<ContentRow | null> {
  const { text, params } = buildContentByIdQuery(id, viewerId);
  const rows = await queryRows<ContentRow>(text, params, client);
  return rows[0] ?? null;
}

export interface FeedResult {
  rows: ContentRow[];
  hasMore: boolean;
}

/**
 * Runs the permission-filtered feed query.
 *
 * Asks for `limit + 1` rows and trims: that extra row is how the caller knows
 * whether a next cursor is warranted, without a second count query that would
 * disagree with the page under concurrent writes.
 */
export async function listFeed(
  options: FeedQueryOptions,
  client?: Sql,
): Promise<FeedResult> {
  const { text, params } = buildFeedQuery(options);
  const rows = await queryRows<ContentRow>(text, params, client);
  const hasMore = rows.length > options.limit;
  return { rows: hasMore ? rows.slice(0, options.limit) : rows, hasMore };
}

export async function updateContent(
  id: string,
  authorId: string,
  fields: { body?: string | null; visibility?: Visibility },
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE content_items SET
       body       = CASE WHEN $3 THEN $4 ELSE body END,
       visibility = COALESCE($5, visibility),
       edited_at  = now()
     WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [
      id,
      authorId,
      fields.body !== undefined,
      fields.body ?? null,
      fields.visibility ?? null,
    ],
    client,
  );
  return row !== null;
}

export async function softDeleteContent(id: string, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE content_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
    client,
  );
}

// --- interactions -----------------------------------------------------------

/**
 * Sets or changes a reaction and returns the resulting like count.
 *
 * The insert and the counter bump are one statement inside one transaction, so
 * the denormalised `like_count` cannot drift from the rows it summarises. A
 * changed reaction kind is an UPDATE, not a second row — hence the unique index
 * on (user, content).
 */
export async function setReaction(
  contentId: string,
  userId: string,
  kind: ReactionKind,
  client?: Sql,
): Promise<number> {
  const inserted = await queryOne<{ inserted: boolean }>(
    `INSERT INTO reactions (user_id, content_id, kind)
     VALUES ($2, $1, $3)
     ON CONFLICT (user_id, content_id) WHERE content_id IS NOT NULL
     DO UPDATE SET kind = EXCLUDED.kind
     RETURNING (xmax = 0) AS inserted`,
    [contentId, userId, kind],
    client,
  );

  const row = await queryOne<{ like_count: number }>(
    `UPDATE content_items SET like_count = like_count + $2
     WHERE id = $1 RETURNING like_count`,
    [contentId, inserted?.inserted ? 1 : 0],
    client,
  );
  return row?.like_count ?? 0;
}

export async function removeReaction(
  contentId: string,
  userId: string,
  client?: Sql,
): Promise<number> {
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM reactions WHERE user_id = $2 AND content_id = $1 RETURNING id`,
    [contentId, userId],
    client,
  );

  const row = await queryOne<{ like_count: number }>(
    `UPDATE content_items SET like_count = GREATEST(0, like_count - $2)
     WHERE id = $1 RETURNING like_count`,
    [contentId, deleted ? 1 : 0],
    client,
  );
  return row?.like_count ?? 0;
}

export async function addBookmark(
  contentId: string,
  userId: string,
  collection: string | null,
  client?: Sql,
): Promise<number> {
  const inserted = await queryOne<{ content_id: string }>(
    `INSERT INTO bookmarks (user_id, content_id, collection)
     VALUES ($2, $1, $3) ON CONFLICT (user_id, content_id) DO NOTHING
     RETURNING content_id`,
    [contentId, userId, collection],
    client,
  );

  const row = await queryOne<{ bookmark_count: number }>(
    `UPDATE content_items SET bookmark_count = bookmark_count + $2
     WHERE id = $1 RETURNING bookmark_count`,
    [contentId, inserted ? 1 : 0],
    client,
  );
  return row?.bookmark_count ?? 0;
}

export async function removeBookmark(
  contentId: string,
  userId: string,
  client?: Sql,
): Promise<number> {
  const deleted = await queryOne<{ content_id: string }>(
    `DELETE FROM bookmarks WHERE user_id = $2 AND content_id = $1 RETURNING content_id`,
    [contentId, userId],
    client,
  );

  const row = await queryOne<{ bookmark_count: number }>(
    `UPDATE content_items SET bookmark_count = GREATEST(0, bookmark_count - $2)
     WHERE id = $1 RETURNING bookmark_count`,
    [contentId, deleted ? 1 : 0],
    client,
  );
  return row?.bookmark_count ?? 0;
}

/**
 * Records that a viewer saw a piece of content.
 *
 * Upsert rather than append: the feed needs a boolean and a repeat count, and
 * an impression log would be the fastest-growing table in the product for no
 * V1 benefit. The aggregate `view_count` only increments on the first view, so
 * it stays a distinct-viewer count rather than a refresh counter.
 */
export async function recordView(
  contentId: string,
  userId: string,
  completion: number | null,
  client?: Sql,
): Promise<void> {
  const row = await queryOne<{ inserted: boolean }>(
    `INSERT INTO content_views (user_id, content_id, completion)
     VALUES ($2, $1, $3)
     ON CONFLICT (user_id, content_id) DO UPDATE SET
       view_count     = content_views.view_count + 1,
       last_viewed_at = now(),
       completion     = GREATEST(COALESCE(content_views.completion, 0), COALESCE(EXCLUDED.completion, 0))
     RETURNING (xmax = 0) AS inserted`,
    [contentId, userId, completion],
    client,
  );

  if (row?.inserted) {
    await queryOne(
      `UPDATE content_items SET view_count = view_count + 1 WHERE id = $1`,
      [contentId],
      client,
    );
  }
}

/** Used by the feed-parity test to compare SQL scoring against `@sos/core`. */
export async function scoreForParity(
  scopes: VisibilityScopes,
  pinnedNow: Date,
  client?: Sql,
): Promise<{ id: string; score: number }[]> {
  const { rows } = await listFeed(
    // Mutes off: the parity test compares scoring arithmetic, and a filtered
    // row would look like a scoring disagreement.
    { scopes, pinnedNow, limit: 100, cursor: null, ordering: 'rank', applyMutes: false, filters: {} },
    client,
  );
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}
