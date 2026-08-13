import type { JoinPolicy, MembershipRole, MembershipStatus, Visibility } from '@sos/contracts';
import type { GroupRef, Membership } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Group persistence.
 */

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  visibility: Visibility;
  join_policy: JoinPolicy;
  member_count: number;
  max_members: number;
  community_id: string | null;
  community_name_ar: string | null;
  community_name_en: string | null;
  course_id: string | null;
  course_name_ar: string | null;
  course_name_en: string | null;
  university_id: string | null;
  college_id: string | null;
  stage_id: string | null;
  created_at: Date;
  archived_at: Date | null;
  viewer_role: MembershipRole | null;
  viewer_status: MembershipStatus | null;
  pending_request_count: number | null;
}

const GROUP_SELECT = `
  SELECT g.id, g.name, g.description, g.avatar_url, g.visibility, g.join_policy,
         g.member_count, g.max_members, g.community_id, g.course_id,
         g.university_id, g.college_id, g.stage_id, g.created_at, g.archived_at,
         comm.name_ar AS community_name_ar, comm.name_en AS community_name_en,
         c.name_ar    AS course_name_ar,    c.name_en    AS course_name_en,
         gm.role   AS viewer_role,
         gm.status AS viewer_status,
         CASE WHEN gm.role IN ('owner', 'admin', 'moderator') AND gm.status = 'active'
              THEN (SELECT count(*)::int FROM group_members q
                    WHERE q.group_id = g.id AND q.status = 'pending')
              ELSE NULL END AS pending_request_count
  FROM groups g
  LEFT JOIN communities comm ON comm.id = g.community_id
  LEFT JOIN courses c ON c.id = g.course_id
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1::uuid
`;

export function toGroupRef(row: GroupRow): GroupRef {
  return {
    id: row.id,
    communityId: row.community_id,
    courseId: row.course_id,
    visibility: row.visibility,
    joinPolicy: row.join_policy,
    memberCount: row.member_count,
    maxMembers: row.max_members,
    universityId: row.university_id,
    collegeId: row.college_id,
    stageId: row.stage_id,
    archivedAt: row.archived_at,
  };
}

export function toMembership(row: {
  viewer_role: MembershipRole | null;
  viewer_status: MembershipStatus | null;
}): Membership | null {
  if (!row.viewer_role || !row.viewer_status) return null;
  return { role: row.viewer_role, status: row.viewer_status };
}

export async function findGroupById(
  groupId: string,
  viewerId: string,
  client?: Sql,
): Promise<GroupRow | null> {
  return queryOne<GroupRow>(`${GROUP_SELECT} WHERE g.id = $2`, [viewerId, groupId], client);
}

export interface CreateGroupInput {
  name: string;
  description: string | null;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  maxMembers: number;
  communityId: string | null;
  courseId: string | null;
  createdBy: string;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
}

export async function insertGroup(input: CreateGroupInput, client?: Sql): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO groups (
       name, description, visibility, join_policy, max_members,
       community_id, course_id, created_by, university_id, college_id, stage_id,
       member_count
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
     RETURNING id`,
    [
      input.name,
      input.description,
      input.visibility,
      input.joinPolicy,
      input.maxMembers,
      input.communityId,
      input.courseId,
      input.createdBy,
      input.universityId,
      input.collegeId,
      input.stageId,
    ],
    client,
  );
  if (!row) throw new Error('insertGroup returned no row');
  return row;
}

export async function updateGroup(
  groupId: string,
  fields: {
    name?: string;
    description?: string | null;
    visibility?: Visibility;
    joinPolicy?: JoinPolicy;
    maxMembers?: number;
  },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE groups SET
       name        = COALESCE($2, name),
       description = CASE WHEN $3 THEN $4 ELSE description END,
       visibility  = COALESCE($5, visibility),
       join_policy = COALESCE($6, join_policy),
       max_members = COALESCE($7, max_members)
     WHERE id = $1`,
    [
      groupId,
      fields.name ?? null,
      fields.description !== undefined,
      fields.description ?? null,
      fields.visibility ?? null,
      fields.joinPolicy ?? null,
      fields.maxMembers ?? null,
    ],
    client,
  );
}

export async function archiveGroup(groupId: string, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE groups SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
    [groupId],
    client,
  );
}

// --- membership -------------------------------------------------------------

/**
 * Adds or updates a membership row.
 *
 * `member_count` moves in the same statement chain and only when the row
 * actually transitions into `active`, so the denormalised count cannot drift
 * from the rows it summarises — the same discipline the content counters use.
 */
export async function upsertMembership(
  input: {
    groupId: string;
    userId: string;
    role: MembershipRole;
    status: MembershipStatus;
    invitedBy?: string | null;
    message?: string | null;
  },
  client?: Sql,
): Promise<{ became_active: boolean }> {
  /*
   * `requested_at` is computed here rather than with a CASE over the status
   * parameter: using the same placeholder as both an enum value and a text
   * comparand makes Postgres refuse to deduce its type.
   */
  const requestedAt = input.status === 'pending' ? new Date() : null;

  const row = await queryOne<{ became_active: boolean }>(
    `WITH before AS (
       SELECT status FROM group_members WHERE group_id = $1 AND user_id = $2
     ), upserted AS (
       INSERT INTO group_members (group_id, user_id, role, status, invited_by, requested_at, message)
       VALUES ($1, $2, $3::membership_role, $4::membership_status, $5, $6, $7)
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         role         = EXCLUDED.role,
         status       = EXCLUDED.status,
         invited_by   = COALESCE(EXCLUDED.invited_by, group_members.invited_by),
         requested_at = COALESCE(EXCLUDED.requested_at, group_members.requested_at),
         message      = COALESCE(EXCLUDED.message, group_members.message)
       RETURNING status
     )
     SELECT (
       (SELECT status FROM upserted) = 'active'
       AND COALESCE((SELECT status FROM before), 'left'::membership_status) <> 'active'
     ) AS became_active`,
    [
      input.groupId,
      input.userId,
      input.role,
      input.status,
      input.invitedBy ?? null,
      requestedAt,
      input.message ?? null,
    ],
    client,
  );

  if (row?.became_active) {
    await queryOne(
      `UPDATE groups SET member_count = member_count + 1 WHERE id = $1`,
      [input.groupId],
      client,
    );
  }
  return { became_active: row?.became_active === true };
}

export async function removeMembership(
  groupId: string,
  userId: string,
  nextStatus: 'left' | 'banned',
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE group_members SET status = $3 WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId, nextStatus],
    client,
  );

  // Recount rather than decrement. This path runs for leave, kick and ban, and
  // a decrement that fired on a row which was already inactive would drift the
  // count downward over time. One aggregate over a single group's members is
  // cheap at this scale and cannot drift.
  await queryOne(
    `UPDATE groups SET member_count = (
       SELECT count(*) FROM group_members WHERE group_id = $1 AND status = 'active'
     ) WHERE id = $1`,
    [groupId],
    client,
  );
}

export async function findMembership(
  groupId: string,
  userId: string,
  client?: Sql,
): Promise<Membership | null> {
  const row = await queryOne<{ role: MembershipRole; status: MembershipStatus }>(
    `SELECT role, status FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
    client,
  );
  return row ? { role: row.role, status: row.status } : null;
}

/**
 * Hands ownership to another member.
 *
 * Both updates run in the caller's transaction, so the group can never be
 * observed with two owners or none.
 */
export async function transferOwnership(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`,
    [groupId, fromUserId],
    client,
  );
  await queryOne(
    `UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`,
    [groupId, toUserId],
    client,
  );
}

export interface MemberRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  stage_name_ar: string | null;
  stage_name_en: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  joined_at: Date | null;
  requested_at: Date | null;
  message: string | null;
}

export async function listMembers(
  groupId: string,
  status: MembershipStatus,
  excludedUserIds: readonly string[],
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<MemberRow[]> {
  const params: unknown[] = [groupId, status, excludedUserIds, limit + 1];
  let cursorClause = '';
  if (cursor) {
    params.push(new Date(cursor.createdAt), cursor.id);
    cursorClause = `AND (gm.joined_at, gm.user_id) < ($5::timestamptz, $6::uuid)`;
  }

  return queryRows<MemberRow>(
    `SELECT gm.user_id, p.handle, p.display_name, p.avatar_url, u.verification_level,
            st.name_ar AS stage_name_ar, st.name_en AS stage_name_en,
            co.name_ar AS college_name_ar, co.name_en AS college_name_en,
            gm.role, gm.status, gm.joined_at, gm.requested_at, gm.message
     FROM group_members gm
     JOIN profiles p ON p.user_id = gm.user_id
     JOIN users u ON u.id = gm.user_id AND u.deleted_at IS NULL
     LEFT JOIN stages st ON st.id = p.stage_id
     LEFT JOIN colleges co ON co.id = p.college_id
     WHERE gm.group_id = $1
       AND gm.status = $2
       AND NOT (gm.user_id = ANY($3::uuid[]))
       ${cursorClause}
     ORDER BY gm.joined_at DESC, gm.user_id DESC
     LIMIT $4`,
    params,
    client,
  );
}

// --- listing ----------------------------------------------------------------

/**
 * Groups the actor belongs to.
 *
 * Membership is the filter, so there is no visibility clause to get wrong: if
 * you are in it, you can list it.
 */
export async function listMyGroups(
  viewerId: string,
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<GroupRow[]> {
  const params: unknown[] = [viewerId, limit + 1];
  let cursorClause = '';
  if (cursor) {
    params.push(new Date(cursor.createdAt), cursor.id);
    cursorClause = `AND (g.created_at, g.id) < ($3::timestamptz, $4::uuid)`;
  }
  return queryRows<GroupRow>(
    `${GROUP_SELECT}
     WHERE gm.status = 'active' AND g.archived_at IS NULL ${cursorClause}
     ORDER BY g.created_at DESC, g.id DESC
     LIMIT $2`,
    params,
    client,
  );
}

/**
 * Discoverable groups.
 *
 * The scope predicate mirrors `canDiscoverGroup`: unlisted groups are excluded
 * in the query, not filtered out afterwards, so a secret group never occupies a
 * slot in a page and its existence is not inferable from a short result.
 */
export async function listDiscoverableGroups(
  scopes: {
    userId: string;
    universityId: string | null;
    collegeId: string | null;
    stageId: string | null;
    courseIds: string[];
    communityIds: string[];
  },
  filters: { communityId?: string | undefined; courseId?: string | undefined },
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<GroupRow[]> {
  const params: unknown[] = [
    scopes.userId,
    scopes.universityId,
    scopes.collegeId,
    scopes.stageId,
    scopes.courseIds,
    scopes.communityIds,
    limit + 1,
  ];

  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const extra: string[] = [];
  if (filters.communityId) extra.push(`g.community_id = ${push(filters.communityId)}::uuid`);
  if (filters.courseId) extra.push(`g.course_id = ${push(filters.courseId)}::uuid`);

  let cursorClause = '';
  if (cursor) {
    cursorClause = `AND (g.created_at, g.id) < (${push(new Date(cursor.createdAt))}::timestamptz, ${push(
      cursor.id,
    )}::uuid)`;
  }

  return queryRows<GroupRow>(
    `${GROUP_SELECT}
     WHERE g.archived_at IS NULL
       AND g.visibility <> 'group'
       AND (gm.status IS NULL OR gm.status <> 'banned')
       AND (
         g.visibility = 'university' AND g.university_id = $2::uuid
         OR g.visibility = 'college'    AND g.college_id = $3::uuid
         OR g.visibility = 'stage'      AND g.college_id = $3::uuid AND g.stage_id = $4::uuid
         OR g.visibility = 'course'     AND g.course_id = ANY($5::uuid[])
         OR g.visibility = 'community'  AND g.community_id = ANY($6::uuid[])
         OR g.visibility = 'public'
       )
       ${extra.length > 0 ? `AND ${extra.join(' AND ')}` : ''}
       ${cursorClause}
     ORDER BY g.created_at DESC, g.id DESC
     LIMIT $7`,
    params,
    client,
  );
}
