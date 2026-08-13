import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Social graph persistence: follow, block, mute.
 */

export async function follow(
  followerId: string,
  followeeId: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ follower_id: string }>(
    `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING follower_id`,
    [followerId, followeeId],
    client,
  );
  if (!row) return false;

  await queryOne(
    `UPDATE profiles SET follower_count = follower_count + 1 WHERE user_id = $1`,
    [followeeId],
    client,
  );
  await queryOne(
    `UPDATE profiles SET following_count = following_count + 1 WHERE user_id = $1`,
    [followerId],
    client,
  );
  return true;
}

export async function unfollow(
  followerId: string,
  followeeId: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ follower_id: string }>(
    `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2 RETURNING follower_id`,
    [followerId, followeeId],
    client,
  );
  if (!row) return false;

  await queryOne(
    `UPDATE profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE user_id = $1`,
    [followeeId],
    client,
  );
  await queryOne(
    `UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE user_id = $1`,
    [followerId],
    client,
  );
  return true;
}

/**
 * Blocks a user and severs any follow in either direction.
 *
 * Leaving the follow edges in place would keep the blocked user's content
 * eligible for `followers`-scoped visibility the moment the block is lifted,
 * and would leave them counted in a follower total the blocker can see.
 */
export async function block(
  blockerId: string,
  blockedId: string,
  reason: string | null,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO blocks (blocker_id, blocked_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [blockerId, blockedId, reason],
    client,
  );
  await unfollow(blockerId, blockedId, client);
  await unfollow(blockedId, blockerId, client);
}

export async function unblock(
  blockerId: string,
  blockedId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [blockerId, blockedId],
    client,
  );
}

export async function mute(
  userId: string,
  targetType: string,
  targetId: string,
  expiresAt: Date | null,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO mutes (user_id, target_type, target_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [userId, targetType, targetId, expiresAt],
    client,
  );
}

export async function unmute(
  userId: string,
  targetType: string,
  targetId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `DELETE FROM mutes WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
    [userId, targetType, targetId],
    client,
  );
}

export interface RelationshipRow {
  is_following: boolean;
  is_followed_by: boolean;
  is_blocked: boolean;
  is_muted: boolean;
  follower_count: number;
}

export async function getRelationship(
  viewerId: string,
  targetId: string,
  client?: Sql,
): Promise<RelationshipRow | null> {
  return queryOne<RelationshipRow>(
    `SELECT
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS is_followed_by,
       EXISTS (SELECT 1 FROM blocks  WHERE blocker_id = $1 AND blocked_id = $2)   AS is_blocked,
       EXISTS (SELECT 1 FROM mutes   WHERE user_id = $1 AND target_type = 'user'
                                       AND target_id = $2
                                       AND (expires_at IS NULL OR expires_at > now())) AS is_muted,
       COALESCE((SELECT follower_count FROM profiles WHERE user_id = $2), 0) AS follower_count`,
    [viewerId, targetId],
    client,
  );
}

export interface ProfileSummaryRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  stage_name_ar: string | null;
  stage_name_en: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
  created_at: Date;
}

const SUMMARY_SELECT = `
  SELECT p.user_id, p.handle, p.display_name, p.avatar_url, u.verification_level,
         st.name_ar AS stage_name_ar, st.name_en AS stage_name_en,
         co.name_ar AS college_name_ar, co.name_en AS college_name_en,
         f.created_at
  FROM follows f
  JOIN profiles p ON p.user_id = %JOIN_COL%
  JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
  LEFT JOIN stages st ON st.id = p.stage_id
  LEFT JOIN colleges co ON co.id = p.college_id
`;

async function listFollowEdge(
  column: 'f.followee_id' | 'f.follower_id',
  matchColumn: 'f.follower_id' | 'f.followee_id',
  userId: string,
  excludedUserIds: readonly string[],
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<ProfileSummaryRow[]> {
  const params: unknown[] = [userId, excludedUserIds, limit + 1];
  let cursorClause = '';
  if (cursor) {
    params.push(new Date(cursor.createdAt), cursor.id);
    cursorClause = `AND (f.created_at, p.user_id) < ($4::timestamptz, $5::uuid)`;
  }

  return queryRows<ProfileSummaryRow>(
    `${SUMMARY_SELECT.replace('%JOIN_COL%', column)}
     WHERE ${matchColumn} = $1
       AND NOT (p.user_id = ANY($2::uuid[]))
       ${cursorClause}
     ORDER BY f.created_at DESC, p.user_id DESC
     LIMIT $3`,
    params,
    client,
  );
}

export function listFollowing(
  userId: string,
  excludedUserIds: readonly string[],
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<ProfileSummaryRow[]> {
  return listFollowEdge('f.followee_id', 'f.follower_id', userId, excludedUserIds, cursor, limit, client);
}

export function listFollowers(
  userId: string,
  excludedUserIds: readonly string[],
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<ProfileSummaryRow[]> {
  return listFollowEdge('f.follower_id', 'f.followee_id', userId, excludedUserIds, cursor, limit, client);
}

// --- moderation -------------------------------------------------------------

const REPORT_COLUMN: Record<string, string> = {
  content: 'content_id',
  comment: 'comment_id',
  profile: 'profile_id',
  group: 'group_id',
  community: 'community_id',
};

/**
 * Files a report.
 *
 * The target column is chosen from a fixed map, never interpolated from the
 * request — the `reports` table has an exactly-one-target CHECK, and a
 * caller-controlled column name would be an injection point.
 */
export async function insertReport(
  input: {
    reporterId: string;
    targetType: keyof typeof REPORT_COLUMN | string;
    targetId: string;
    reason: string;
    details: string | null;
  },
  client?: Sql,
): Promise<{ id: string; status: string; created_at: Date } | null> {
  const column = REPORT_COLUMN[input.targetType];
  if (!column) return null;

  return queryOne<{ id: string; status: string; created_at: Date }>(
    `INSERT INTO reports (reporter_id, reason, details, ${column})
     VALUES ($1, $2, $3, $4)
     RETURNING id, status, created_at`,
    [input.reporterId, input.reason, input.details, input.targetId],
    client,
  );
}

/** One open report per reporter per target — re-reporting must not spam the queue. */
export async function hasOpenReport(
  reporterId: string,
  targetType: string,
  targetId: string,
  client?: Sql,
): Promise<boolean> {
  const column = REPORT_COLUMN[targetType];
  if (!column) return false;
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reports
       WHERE reporter_id = $1 AND ${column} = $2 AND status IN ('open', 'reviewing')
     ) AS exists`,
    [reporterId, targetId],
    client,
  );
  return row?.exists === true;
}
