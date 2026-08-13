import type { VisibilityScopes } from '@sos/core';
import { queryRows, type Sql } from '../../platform/db.js';
import type { CommunityRow } from '../communities/communities.repository.js';
import type { GroupRow } from '../groups/groups.repository.js';

/**
 * Search.
 *
 * The point of this module, and the reason it exists in the same phase as
 * groups: **search runs the same permission predicate as the feed.** If search
 * had its own filter, a private group's posts would be one query away from
 * anyone who knew a keyword — which is exactly the leak the phase's exit
 * criterion is about.
 *
 * Ranking is trigram similarity. Not a relevance model: at cohort scale, "does
 * this contain what I typed" is the whole requirement, and a scoring scheme
 * nobody can explain is worse than an obvious one. Semantic search over
 * embeddings is Phase 11 and will be a different endpoint, not a silent change
 * to this one.
 */

/** Below this, a trigram match is noise rather than a result. */
const SIMILARITY_FLOOR = 0.15;

export interface PersonHit {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  stage_name_ar: string | null;
  stage_name_en: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
}

/**
 * People search.
 *
 * Honours `privacy_settings.searchable` and both block directions. A student
 * who has opted out of discovery must not be findable by typing their name.
 */
export async function searchPeople(
  term: string,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<PersonHit[]> {
  return queryRows<PersonHit>(
    `SELECT p.user_id, p.handle, p.display_name, p.avatar_url, u.verification_level,
            st.name_ar AS stage_name_ar, st.name_en AS stage_name_en,
            co.name_ar AS college_name_ar, co.name_en AS college_name_en
     FROM profiles p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
     LEFT JOIN stages st ON st.id = p.stage_id
     LEFT JOIN colleges co ON co.id = p.college_id
     WHERE u.deleted_at IS NULL
       AND u.status NOT IN ('banned', 'deleted')
       AND COALESCE(ps.searchable, true)
       AND NOT (p.user_id = ANY($3::uuid[]))
       AND (
         GREATEST(similarity(p.display_name, $1), similarity(p.handle, $1)) >= $5
         OR p.handle ILIKE $2
       )
       AND (
         p.user_id = $4::uuid
         OR COALESCE(ps.profile_visibility, 'stage') = 'public'
         OR COALESCE(ps.profile_visibility, 'stage') = 'university'
            AND p.university_id = $6::uuid
         OR COALESCE(ps.profile_visibility, 'stage') = 'college'
            AND p.college_id = $7::uuid
         OR COALESCE(ps.profile_visibility, 'stage') NOT IN ('public', 'university', 'college', 'private')
            AND p.college_id = $7::uuid AND p.stage_id = $8::uuid
       )
     ORDER BY GREATEST(similarity(p.display_name, $1), similarity(p.handle, $1)) DESC,
              p.display_name
     LIMIT $9`,
    [
      term,
      `${term}%`,
      scopes.excludedUserIds,
      scopes.userId,
      SIMILARITY_FLOOR,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      limit,
    ],
    client,
  );
}

export interface ContentHit {
  id: string;
  body: string | null;
  created_at: Date;
  author_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  stage_name_ar: string | null;
  stage_name_en: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
}

/**
 * Content search.
 *
 * The WHERE clause below is the same predicate the feed uses, including the
 * hard container boundary. It is repeated rather than shared because the two
 * queries select different columns and shapes — and an integration test asserts
 * the two agree, which is what stops them drifting.
 */
export async function searchContent(
  term: string,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<ContentHit[]> {
  return queryRows<ContentHit>(
    `SELECT ci.id, ci.body, ci.created_at, ci.author_id,
            p.handle, p.display_name, p.avatar_url, u.verification_level,
            st.name_ar AS stage_name_ar, st.name_en AS stage_name_en,
            co.name_ar AS college_name_ar, co.name_en AS college_name_en
     FROM content_items ci
     JOIN users u ON u.id = ci.author_id
     JOIN profiles p ON p.user_id = ci.author_id
     LEFT JOIN stages st ON st.id = p.stage_id
     LEFT JOIN colleges co ON co.id = p.college_id
     WHERE ci.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND u.status NOT IN ('banned', 'deleted')
       AND NOT (ci.author_id = ANY($10::uuid[]))
       AND ci.body IS NOT NULL
       AND (ci.body ILIKE $2 OR similarity(ci.body, $1) >= $3)
       AND (
         ci.author_id = $4::uuid
         OR (
           (ci.group_id IS NULL OR ci.group_id = ANY($7::uuid[]))
           AND (ci.classroom_id IS NULL OR ci.classroom_id = ANY($8::uuid[]))
           AND (ci.community_id IS NULL OR ci.visibility <> 'community'
                OR ci.community_id = ANY($6::uuid[]))
           AND (
             ci.visibility = 'public'
             OR ci.visibility = 'university' AND ci.university_id = $11::uuid
             OR ci.visibility = 'college'    AND ci.college_id = $12::uuid
             OR ci.visibility = 'stage'      AND ci.college_id = $12::uuid AND ci.stage_id = $13::uuid
             OR ci.visibility = 'course'     AND ci.course_id = ANY($5::uuid[])
             OR ci.visibility = 'community'  AND ci.community_id = ANY($6::uuid[])
             OR ci.visibility = 'group'      AND ci.group_id = ANY($7::uuid[])
             OR ci.visibility = 'classroom'  AND ci.classroom_id = ANY($8::uuid[])
             OR ci.visibility = 'followers'  AND ci.author_id = ANY($9::uuid[])
           )
         )
       )
     ORDER BY similarity(ci.body, $1) DESC, ci.created_at DESC
     LIMIT $14`,
    [
      term,
      `%${term}%`,
      SIMILARITY_FLOOR,
      scopes.userId,
      scopes.courseIds,
      scopes.communityIds,
      scopes.groupIds,
      scopes.classroomIds,
      scopes.followingIds,
      scopes.excludedUserIds,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      limit,
    ],
    client,
  );
}

/**
 * Group search.
 *
 * Unlisted groups are excluded here as they are in discovery. A group that
 * cannot be browsed to must not be reachable by guessing its name.
 */
export async function searchGroups(
  term: string,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<GroupRow[]> {
  return queryRows<GroupRow>(
    `SELECT g.id, g.name, g.description, g.avatar_url, g.visibility, g.join_policy,
            g.member_count, g.max_members, g.community_id, g.course_id,
            g.university_id, g.college_id, g.stage_id, g.created_at, g.archived_at,
            comm.name_ar AS community_name_ar, comm.name_en AS community_name_en,
            c.name_ar AS course_name_ar, c.name_en AS course_name_en,
            gm.role AS viewer_role, gm.status AS viewer_status,
            NULL::int AS pending_request_count
     FROM groups g
     LEFT JOIN communities comm ON comm.id = g.community_id
     LEFT JOIN courses c ON c.id = g.course_id
     LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2::uuid
     WHERE g.archived_at IS NULL
       AND (g.name ILIKE $6 OR similarity(g.name, $1) >= $7)
       AND (
         gm.status = 'active'
         OR (
           g.visibility <> 'group'
           AND (gm.status IS NULL OR gm.status <> 'banned')
           AND (
             g.visibility = 'public'
             OR g.visibility = 'university' AND g.university_id = $3::uuid
             OR g.visibility = 'college'    AND g.college_id = $4::uuid
             OR g.visibility = 'stage'      AND g.college_id = $4::uuid AND g.stage_id = $5::uuid
             OR g.visibility = 'course'     AND g.course_id = ANY($8::uuid[])
             OR g.visibility = 'community'  AND g.community_id = ANY($9::uuid[])
           )
         )
       )
     ORDER BY similarity(g.name, $1) DESC, g.member_count DESC
     LIMIT $10`,
    [
      term,
      scopes.userId,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      `%${term}%`,
      SIMILARITY_FLOOR,
      scopes.courseIds,
      scopes.communityIds,
      limit,
    ],
    client,
  );
}

export async function searchCommunities(
  term: string,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<CommunityRow[]> {
  return queryRows<CommunityRow>(
    `SELECT cm.id, cm.slug, cm.name_ar, cm.name_en, cm.description, cm.cover_url,
            cm.visibility, cm.is_official, cm.member_count,
            cm.university_id, cm.college_id, cm.stage_id, cm.course_id,
            cm.archived_at, cm.created_at,
            c.name_ar AS course_name_ar, c.name_en AS course_name_en,
            mem.role AS viewer_role, mem.status AS viewer_status
     FROM communities cm
     LEFT JOIN courses c ON c.id = cm.course_id
     LEFT JOIN community_members mem ON mem.community_id = cm.id AND mem.user_id = $2::uuid
     WHERE cm.archived_at IS NULL
       AND (cm.name_ar ILIKE $6 OR cm.name_en ILIKE $6
            OR GREATEST(similarity(cm.name_ar, $1), similarity(cm.name_en, $1)) >= $7)
       AND (
         cm.visibility = 'public'
         OR cm.visibility = 'university' AND cm.university_id = $3::uuid
         OR cm.visibility = 'college'    AND cm.college_id = $4::uuid
         OR cm.visibility = 'stage'      AND cm.college_id = $4::uuid AND cm.stage_id = $5::uuid
         OR cm.visibility = 'course'     AND cm.course_id = ANY($8::uuid[])
       )
     ORDER BY GREATEST(similarity(cm.name_ar, $1), similarity(cm.name_en, $1)) DESC,
              cm.is_official DESC
     LIMIT $9`,
    [
      term,
      scopes.userId,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      `%${term}%`,
      SIMILARITY_FLOOR,
      scopes.courseIds,
      limit,
    ],
    client,
  );
}
