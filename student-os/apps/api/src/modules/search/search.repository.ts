import { normalizeArabic, type VisibilityScopes } from '@sos/core';
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
 *
 * Every comparison runs against a `*_norm` column and a normalised term. The
 * fold is documented, with its measured justification, in
 * `@sos/core/text/arabic` and mirrored by `sos_normalize_arabic()` in migration
 * 0009. Normalising one side only would match nothing; normalising the column
 * inline would discard the index.
 *
 * Topics and classrooms were added in 0017. Topics are academic reference
 * data (the same rule `GET /v1/topics/:id` follows). Classrooms reuse the
 * `canViewClassroom` predicate: unlisted rooms are absent to non-members.
 */

/** Below this, a trigram match is noise rather than a result. */
const SIMILARITY_FLOOR = 0.15;

/**
 * What every query below actually compares.
 *
 * Built once per search so the term cannot be normalised on one branch and not
 * another — the failure mode being that people search works in Arabic and
 * content search silently does not.
 */
export interface SearchTerm {
  /** Normalised, for both similarity and substring matching. */
  norm: string;
  /** `%term%` — substring, since trigrams alone miss very short queries. */
  contains: string;
  /** `term%` — prefix, used where a substring match would be too loose. */
  prefix: string;
}

export function prepareTerm(raw: string): SearchTerm {
  const norm = normalizeArabic(raw);
  // ILIKE metacharacters in a user-supplied term would otherwise turn a search
  // for "50%" into a match on everything.
  const escaped = norm.replace(/([\\%_])/gu, '\\$1');
  return { norm, contains: `%${escaped}%`, prefix: `${escaped}%` };
}

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
  term: SearchTerm,
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
       AND u.status NOT IN ('suspended', 'banned', 'deleted')
       AND COALESCE(ps.searchable, true)
       AND NOT (p.user_id = ANY($3::uuid[]))
       AND (
         GREATEST(similarity(p.display_name_norm, $1), similarity(p.handle, $1)) >= $5
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
     ORDER BY GREATEST(similarity(p.display_name_norm, $1), similarity(p.handle, $1)) DESC,
              p.display_name
     LIMIT $9`,
    [
      term.norm,
      term.prefix,
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
  term: SearchTerm,
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
       AND u.status NOT IN ('suspended', 'banned', 'deleted')
       AND NOT (ci.author_id = ANY($10::uuid[]))
       AND ci.body IS NOT NULL
       AND (ci.body_norm ILIKE $2 OR similarity(ci.body_norm, $1) >= $3)
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
     ORDER BY similarity(ci.body_norm, $1) DESC, ci.created_at DESC
     LIMIT $14`,
    [
      term.norm,
      term.contains,
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
  term: SearchTerm,
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
       AND (g.name_norm ILIKE $6 OR similarity(g.name_norm, $1) >= $7)
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
     ORDER BY similarity(g.name_norm, $1) DESC, g.member_count DESC
     LIMIT $10`,
    [
      term.norm,
      scopes.userId,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      term.contains,
      SIMILARITY_FLOOR,
      scopes.courseIds,
      scopes.communityIds,
      limit,
    ],
    client,
  );
}

export async function searchCommunities(
  term: SearchTerm,
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
       AND (cm.name_ar_norm ILIKE $6 OR cm.name_en_norm ILIKE $6
            OR GREATEST(similarity(cm.name_ar_norm, $1),
                        similarity(cm.name_en_norm, $1)) >= $7)
       AND (
         cm.visibility = 'public'
         OR cm.visibility = 'university' AND cm.university_id = $3::uuid
         OR cm.visibility = 'college'    AND cm.college_id = $4::uuid
         OR cm.visibility = 'stage'      AND cm.college_id = $4::uuid AND cm.stage_id = $5::uuid
         OR cm.visibility = 'course'     AND cm.course_id = ANY($8::uuid[])
       )
     ORDER BY GREATEST(similarity(cm.name_ar_norm, $1),
                       similarity(cm.name_en_norm, $1)) DESC,
              cm.is_official DESC
     LIMIT $9`,
    [
      term.norm,
      scopes.userId,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      term.contains,
      SIMILARITY_FLOOR,
      scopes.courseIds,
      limit,
    ],
    client,
  );
}

export interface TopicHit {
  id: string;
  name_ar: string;
  name_en: string;
  subject_name_ar: string;
  subject_name_en: string;
  course_name_ar: string;
  course_name_en: string;
  questions_seen: number | null;
  questions_correct: number | null;
}

/**
 * Topic search.
 *
 * A topic is academic reference data, not a permissioned container: every
 * signed-in student may read the hierarchy, the same way `/v1/academic/*` and
 * `GET /v1/topics/:id` already work. What is permission-filtered is the
 * knowledge *inside* a topic, and that is not what this query returns.
 *
 * The viewer's own answered-question counts ride along so Search can render
 * an EvidenceFraction when there is one, and omit it when there is not.
 */
export async function searchTopics(
  term: SearchTerm,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<TopicHit[]> {
  return queryRows<TopicHit>(
    `SELECT t.id, t.name_ar, t.name_en,
            s.name_ar AS subject_name_ar, s.name_en AS subject_name_en,
            c.name_ar AS course_name_ar, c.name_en AS course_name_en,
            lp.questions_seen, lp.questions_correct
     FROM topics t
     JOIN subjects s ON s.id = t.subject_id
     JOIN courses c ON c.id = s.course_id
     LEFT JOIN learning_progress lp
       ON lp.topic_id = t.id AND lp.user_id = $2::uuid
     WHERE t.name_ar_norm ILIKE $3
        OR t.name_en_norm ILIKE $3
        OR GREATEST(similarity(t.name_ar_norm, $1),
                    similarity(t.name_en_norm, $1)) >= $4
     ORDER BY GREATEST(similarity(t.name_ar_norm, $1),
                       similarity(t.name_en_norm, $1)) DESC,
              t.name_en
     LIMIT $5`,
    [term.norm, scopes.userId, term.contains, SIMILARITY_FLOOR, limit],
    client,
  );
}

export interface ClassroomHit {
  id: string;
  course_id: string;
  title: string;
  instructor_id: string | null;
  visibility: string;
  is_archived: boolean;
  course_name_ar: string | null;
  course_name_en: string | null;
  course_code: string | null;
  member_count: number;
  viewer_role: string | null;
  viewer_status: string | null;
}

/**
 * Classroom search.
 *
 * Membership is the filter for unlisted rooms; enrolment is the filter for
 * course-visible ones. The SQL already encodes `canViewClassroom` — an unlisted
 * room a non-member types the name of is absent, not 403'd. Lecture counts are
 * not selected: a non-member learning that a room has twelve lectures is a
 * leak of the room's contents, and search is a discovery surface.
 */
export async function searchClassrooms(
  term: SearchTerm,
  scopes: VisibilityScopes,
  limit: number,
  client?: Sql,
): Promise<ClassroomHit[]> {
  return queryRows<ClassroomHit>(
    `SELECT k.id, k.course_id, k.title, k.instructor_id, k.visibility, k.is_archived,
            c.name_ar AS course_name_ar, c.name_en AS course_name_en, c.code AS course_code,
            (SELECT count(*)::int FROM classroom_members m
               WHERE m.classroom_id = k.id AND m.status = 'active') AS member_count,
            me.role AS viewer_role, me.status AS viewer_status
     FROM classrooms k
     JOIN courses c ON c.id = k.course_id
     LEFT JOIN classroom_members me ON me.classroom_id = k.id AND me.user_id = $2::uuid
     WHERE (k.title_norm ILIKE $3 OR similarity(k.title_norm, $1) >= $4)
       AND (
         me.status = 'active'
         OR (
           k.visibility = 'course'
           AND NOT k.is_archived
           AND k.course_id = ANY($5::uuid[])
         )
       )
     ORDER BY similarity(k.title_norm, $1) DESC, k.created_at DESC
     LIMIT $6`,
    [term.norm, scopes.userId, term.contains, SIMILARITY_FLOOR, scopes.courseIds, limit],
    client,
  );
}
