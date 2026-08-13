import type { Actor } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Auth persistence. SQL only — no business decisions live here.
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'student' | 'instructor' | 'admin';
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  status: 'active' | 'restricted' | 'suspended' | 'banned' | 'deleted';
  locale: 'ar' | 'en';
  onboarding_completed: boolean;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.password_hash, u.role, u.verification_level,
         u.status, u.locale,
         (p.onboarding_completed_at IS NOT NULL) AS onboarding_completed
  FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id
`;

export async function findUserByEmail(email: string, client?: Sql): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `${USER_SELECT} WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL`,
    [email],
    client,
  );
}

export async function findUserById(id: string, client?: Sql): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `${USER_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
    client,
  );
}

export async function insertUser(
  input: { email: string; passwordHash: string; locale: 'ar' | 'en' },
  client?: Sql,
): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `WITH inserted AS (
       INSERT INTO users (email, password_hash, locale)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, role, verification_level, status, locale
     )
     SELECT *, false AS onboarding_completed FROM inserted`,
    [input.email, input.passwordHash, input.locale],
    client,
  );
  if (!row) throw new Error('insertUser returned no row');
  return row;
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  client?: Sql,
): Promise<void> {
  await queryOne(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash], client);
}

export async function touchLastActive(userId: string, client?: Sql): Promise<void> {
  await queryOne(`UPDATE users SET last_active_at = now() WHERE id = $1`, [userId], client);
}

// --- sessions ---------------------------------------------------------------

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  rotated_to_id: string | null;
}

export async function insertSession(
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  },
  client?: Sql,
): Promise<SessionRow> {
  const row = await queryOne<SessionRow>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, expires_at, revoked_at, rotated_to_id`,
    [input.userId, input.tokenHash, input.expiresAt, input.userAgent, input.ip],
    client,
  );
  if (!row) throw new Error('insertSession returned no row');
  return row;
}

export async function findSessionByTokenHash(
  tokenHash: string,
  client?: Sql,
): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at, rotated_to_id
     FROM sessions WHERE token_hash = $1`,
    [tokenHash],
    client,
  );
}

/**
 * Locks the session row for the duration of the surrounding transaction.
 *
 * Refresh is a read-then-write on the same row, so two concurrent refreshes
 * with the same token would otherwise both observe it as unrevoked and both
 * mint a new session. The lock serialises them; the loser sees the row already
 * rotated and is treated as a replay.
 */
export async function findSessionByTokenHashForUpdate(
  tokenHash: string,
  client: Sql,
): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at, rotated_to_id
     FROM sessions WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
    client,
  );
}

export async function findSessionById(id: string, client?: Sql): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at, rotated_to_id FROM sessions WHERE id = $1`,
    [id],
    client,
  );
}

export async function revokeSession(id: string, rotatedToId: string | null, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE sessions SET revoked_at = now(), rotated_to_id = $2 WHERE id = $1 AND revoked_at IS NULL`,
    [id, rotatedToId],
    client,
  );
}

export async function revokeAllSessionsForUser(userId: string, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
    client,
  );
}

// --- actor ------------------------------------------------------------------

interface ActorRow {
  user_id: string;
  role: Actor['role'];
  status: Actor['status'];
  verification_level: Actor['verificationLevel'];
  university_id: string | null;
  college_id: string | null;
  program_id: string | null;
  stage_id: string | null;
  course_ids: string[] | null;
  community_ids: string[] | null;
  group_ids: string[] | null;
  classroom_ids: string[] | null;
  following_ids: string[] | null;
  blocked_user_ids: string[] | null;
  blocked_by_user_ids: string[] | null;
  muted_user_ids: string[] | null;
  muted_group_ids: string[] | null;
  muted_community_ids: string[] | null;
  muted_topic_ids: string[] | null;
}

/**
 * Loads the complete authorization subject in one round trip.
 *
 * This is the most security-critical query in the system: everything the
 * policy layer decides is decided from these sets. It is one query rather than
 * eight lazy lookups precisely so that "what can this user reach?" has a
 * single, reviewable answer.
 *
 * At cohort scale these sets are small (tens of rows). If a user's membership
 * sets ever grow large enough that this becomes expensive, the fix is to cache
 * the Actor per request-batch — not to make the policy layer lazy.
 */
export async function loadActor(userId: string, client?: Sql): Promise<Actor | null> {
  const row = await queryOne<ActorRow>(
    `SELECT
       u.id AS user_id, u.role, u.status, u.verification_level,
       p.university_id, p.college_id, p.program_id, p.stage_id,
       (SELECT array_agg(ce.course_id) FROM course_enrollments ce
          WHERE ce.user_id = u.id AND ce.status = 'active')            AS course_ids,
       (SELECT array_agg(cm.community_id) FROM community_members cm
          WHERE cm.user_id = u.id AND cm.status = 'active')            AS community_ids,
       (SELECT array_agg(gm.group_id) FROM group_members gm
          WHERE gm.user_id = u.id AND gm.status = 'active')            AS group_ids,
       (SELECT array_agg(km.classroom_id) FROM classroom_members km
          WHERE km.user_id = u.id AND km.status = 'active')            AS classroom_ids,
       (SELECT array_agg(f.followee_id) FROM follows f
          WHERE f.follower_id = u.id)                                  AS following_ids,
       (SELECT array_agg(b.blocked_id) FROM blocks b
          WHERE b.blocker_id = u.id)                                   AS blocked_user_ids,
       (SELECT array_agg(b.blocker_id) FROM blocks b
          WHERE b.blocked_id = u.id)                                   AS blocked_by_user_ids,
       -- Mutes are loaded with the same round trip as blocks, and kept in
       -- separate sets. They are a read preference, not a permission, and the
       -- expiry is applied here so no caller has to remember it.
       (SELECT array_agg(m.target_id) FROM mutes m
          WHERE m.user_id = u.id AND m.target_type = 'user'
            AND (m.expires_at IS NULL OR m.expires_at > now()))        AS muted_user_ids,
       (SELECT array_agg(m.target_id) FROM mutes m
          WHERE m.user_id = u.id AND m.target_type = 'group'
            AND (m.expires_at IS NULL OR m.expires_at > now()))        AS muted_group_ids,
       (SELECT array_agg(m.target_id) FROM mutes m
          WHERE m.user_id = u.id AND m.target_type = 'community'
            AND (m.expires_at IS NULL OR m.expires_at > now()))        AS muted_community_ids,
       (SELECT array_agg(m.target_id) FROM mutes m
          WHERE m.user_id = u.id AND m.target_type = 'topic'
            AND (m.expires_at IS NULL OR m.expires_at > now()))        AS muted_topic_ids
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
    client,
  );

  if (!row) return null;

  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    verificationLevel: row.verification_level,
    universityId: row.university_id,
    collegeId: row.college_id,
    programId: row.program_id,
    stageId: row.stage_id,
    courseIds: new Set(row.course_ids ?? []),
    communityIds: new Set(row.community_ids ?? []),
    groupIds: new Set(row.group_ids ?? []),
    classroomIds: new Set(row.classroom_ids ?? []),
    followingIds: new Set(row.following_ids ?? []),
    blockedUserIds: new Set(row.blocked_user_ids ?? []),
    blockedByUserIds: new Set(row.blocked_by_user_ids ?? []),
    mutedUserIds: new Set(row.muted_user_ids ?? []),
    mutedGroupIds: new Set(row.muted_group_ids ?? []),
    mutedCommunityIds: new Set(row.muted_community_ids ?? []),
    mutedTopicIds: new Set(row.muted_topic_ids ?? []),
  };
}

/** Used by the seed script and admin tooling. */
export async function listUserIds(limit = 100, client?: Sql): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT $1`,
    [limit],
    client,
  );
  return rows.map((r) => r.id);
}
