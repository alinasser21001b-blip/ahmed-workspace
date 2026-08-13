import type { MembershipRole, MembershipStatus, Visibility } from '@sos/contracts';
import type { CommunityRef, Membership } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Community persistence.
 */

export interface CommunityRow {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  cover_url: string | null;
  visibility: Visibility;
  is_official: boolean;
  member_count: number;
  university_id: string | null;
  college_id: string | null;
  stage_id: string | null;
  course_id: string | null;
  course_name_ar: string | null;
  course_name_en: string | null;
  archived_at: Date | null;
  created_at: Date;
  viewer_role: MembershipRole | null;
  viewer_status: MembershipStatus | null;
}

const COMMUNITY_SELECT = `
  SELECT cm.id, cm.slug, cm.name_ar, cm.name_en, cm.description, cm.cover_url,
         cm.visibility, cm.is_official, cm.member_count,
         cm.university_id, cm.college_id, cm.stage_id, cm.course_id,
         cm.archived_at, cm.created_at,
         c.name_ar AS course_name_ar, c.name_en AS course_name_en,
         mem.role AS viewer_role, mem.status AS viewer_status
  FROM communities cm
  LEFT JOIN courses c ON c.id = cm.course_id
  LEFT JOIN community_members mem ON mem.community_id = cm.id AND mem.user_id = $1::uuid
`;

export function toRef(row: CommunityRow): CommunityRef {
  return {
    id: row.id,
    universityId: row.university_id,
    collegeId: row.college_id,
    stageId: row.stage_id,
    courseId: row.course_id,
    visibility: row.visibility,
    isOfficial: row.is_official,
    archivedAt: row.archived_at,
  };
}

export function toMembership(row: CommunityRow): Membership | null {
  if (!row.viewer_role || !row.viewer_status) return null;
  return { role: row.viewer_role, status: row.viewer_status };
}

export async function findById(
  communityId: string,
  viewerId: string,
  client?: Sql,
): Promise<CommunityRow | null> {
  return queryOne<CommunityRow>(
    `${COMMUNITY_SELECT} WHERE cm.id = $2`,
    [viewerId, communityId],
    client,
  );
}

export interface ListCommunitiesScopes {
  userId: string;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  courseIds: string[];
}

/**
 * Lists communities.
 *
 * The `discover` predicate mirrors `canViewCommunity` and lives in the query
 * for the same reason the feed's does: filtering after the fetch returns short
 * pages and breaks the cursor.
 */
export async function listCommunities(
  scope: 'mine' | 'discover',
  scopes: ListCommunitiesScopes,
  cursor: { createdAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<CommunityRow[]> {
  /*
   * Parameters are appended as the clauses that use them are built. Binding a
   * fixed list regardless of scope sends Postgres more parameters than the
   * query text references, which it rejects outright — the `mine` branch has no
   * use for the academic scope values.
   */
  const params: unknown[] = [scopes.userId];
  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const scopeClause =
    scope === 'mine'
      ? `mem.status = 'active'`
      : `(
           cm.visibility = 'public'
           OR cm.visibility = 'university' AND cm.university_id = ${push(scopes.universityId)}::uuid
           OR cm.visibility = 'college'    AND cm.college_id = ${push(scopes.collegeId)}::uuid
           OR cm.visibility = 'stage'      AND cm.college_id = ${push(scopes.collegeId)}::uuid
                                           AND cm.stage_id = ${push(scopes.stageId)}::uuid
           OR cm.visibility = 'course'     AND cm.course_id = ANY(${push(scopes.courseIds)}::uuid[])
         )`;

  const cursorClause = cursor
    ? `AND (cm.created_at, cm.id) < (${push(new Date(cursor.createdAt))}::timestamptz, ${push(
        cursor.id,
      )}::uuid)`
    : '';

  return queryRows<CommunityRow>(
    `${COMMUNITY_SELECT}
     WHERE cm.archived_at IS NULL AND ${scopeClause} ${cursorClause}
     ORDER BY cm.is_official DESC, cm.created_at DESC, cm.id DESC
     LIMIT ${push(limit + 1)}`,
    params,
    client,
  );
}

export async function upsertMembership(
  communityId: string,
  userId: string,
  status: 'active' | 'left',
  client?: Sql,
): Promise<void> {
  if (status === 'active') {
    await queryOne(
      `INSERT INTO community_members (community_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'active')
       ON CONFLICT (community_id, user_id) DO UPDATE SET status = 'active'`,
      [communityId, userId],
      client,
    );
  } else {
    await queryOne(
      `UPDATE community_members SET status = 'left'
       WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId],
      client,
    );
  }

  // Recount rather than increment: joins and leaves both land here, and a
  // rejoin after a leave must not double-count.
  await queryOne(
    `UPDATE communities SET member_count = (
       SELECT count(*) FROM community_members
       WHERE community_id = $1 AND status = 'active'
     ) WHERE id = $1`,
    [communityId],
    client,
  );
}
