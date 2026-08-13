import { FEED_WEIGHTS, RECENCY_HALF_LIFE_HOURS, type VisibilityScopes } from '@sos/core';

/**
 * The feed query.
 *
 * Two rules shape everything here.
 *
 * 1. **Filter in the query, never after it.** Fetching rows and discarding the
 *    ones the viewer may not see returns short pages, breaks cursor
 *    pagination, and leaks row counts through the gaps. The permission
 *    predicate below is a direct transcription of `canViewContent` in
 *    `@sos/core`, and an integration test asserts the two agree on every
 *    visibility level.
 *
 * 2. **Weights live in one place.** The scoring arithmetic exists twice — once
 *    in TypeScript for testability, once here because ranking belongs in the
 *    query — but the *numbers* are bound as parameters from `FEED_WEIGHTS`. A
 *    product change to a weight touches one constant, and a parity test proves
 *    the two implementations still agree.
 */

/** Fixed parameter slots, so every fragment below can reference them by number. */
const SCOPE_PARAM_COUNT = 10;

export interface FeedQueryOptions {
  scopes: VisibilityScopes;
  /** The instant the page is scored against — pinned in the cursor across pages. */
  pinnedNow: Date;
  limit: number;
  cursor: { score: number; id: string } | { createdAt: number; id: string } | null;
  ordering: 'rank' | 'recent';
  /**
   * Whether mutes apply to this read.
   *
   * They apply to ambient surfaces — the home feed, `recent`, search — and not
   * to surfaces the reader explicitly asked for: a specific author's posts, a
   * muted group's own page, their own bookmarks. Muting a group is a request to
   * stop hearing from it in passing, not a request to be locked out of it.
   */
  applyMutes: boolean;
  filters: {
    authorId?: string | undefined;
    courseId?: string | undefined;
    topicId?: string | undefined;
    communityId?: string | undefined;
    groupId?: string | undefined;
    bookmarkedBy?: string | undefined;
    /*
     * Knowledge filters — deterministic equality on classified columns. There
     * is no relevance model here and there is not going to be one in this
     * phase: a student asking for explanations of a topic should get exactly
     * that, and be able to tell why each row is in the list.
     */
    knowledgeType?: string | undefined;
    difficulty?: string | undefined;
    language?: string | undefined;
  };
}

/**
 * Transcription of `canViewContent`.
 *
 * The one deliberate divergence: the platform-admin bypass is NOT applied here.
 * An admin's home feed is their own cohort's feed, not every private post in
 * the system. Admin reach is a moderation surface, reached through a single
 * item read that does go through `canViewContent` and is audited.
 */
function visibilityPredicate(): string {
  return `(
    ci.author_id = $1::uuid
    OR (
      -- Containers are hard boundaries: a broader visibility cannot open them.
      (ci.group_id IS NULL OR ci.group_id = ANY($7::uuid[]))
      AND (ci.classroom_id IS NULL OR ci.classroom_id = ANY($8::uuid[]))
      AND (
        ci.community_id IS NULL
        OR ci.visibility <> 'community'
        OR ci.community_id = ANY($6::uuid[])
      )
      AND (
        ci.visibility = 'public'
        OR (ci.visibility = 'university' AND ci.university_id = $2::uuid)
        OR (ci.visibility = 'college'    AND ci.college_id = $3::uuid)
        OR (ci.visibility = 'stage'      AND ci.college_id = $3::uuid AND ci.stage_id = $4::uuid)
        OR (ci.visibility = 'course'     AND ci.course_id = ANY($5::uuid[]))
        OR (ci.visibility = 'community'  AND ci.community_id = ANY($6::uuid[]))
        OR (ci.visibility = 'group'      AND ci.group_id = ANY($7::uuid[]))
        OR (ci.visibility = 'classroom'  AND ci.classroom_id = ANY($8::uuid[]))
        OR (ci.visibility = 'followers'  AND ci.author_id = ANY($9::uuid[]))
      )
    )
  )`;
}

/**
 * Mirrors `scoreFeedCandidate`. Weight placeholders are filled from
 * `FEED_WEIGHTS`; the shape is duplicated, the numbers are not.
 */
function scoreExpression(base: number): string {
  const w = {
    enrolled: `$${base + 1}::float8`,
    weak: `$${base + 2}::float8`,
    interest: `$${base + 3}::float8`,
    cohort: `$${base + 4}::float8`,
    academic: `$${base + 5}::float8`,
    social: `$${base + 6}::float8`,
    engagement: `$${base + 7}::float8`,
    recency: `$${base + 8}::float8`,
    seenPenalty: `$${base + 9}::float8`,
    halfLife: `$${base + 10}::float8`,
    now: `$${base + 11}::timestamptz`,
    classified: `$${base + 12}::float8`,
    sourced: `$${base + 13}::float8`,
    disputed: `$${base + 14}::float8`,
  };

  return `(
    (CASE WHEN ci.course_id = ANY($5::uuid[]) THEN ${w.enrolled} ELSE 0 END)
    + (CASE WHEN sig.matches_weak_topic THEN ${w.weak} ELSE 0 END)
    + (CASE WHEN sig.matches_interest_topic THEN ${w.interest} ELSE 0 END)
    + (CASE WHEN ci.college_id = $3::uuid AND ci.stage_id = $4::uuid THEN ${w.cohort} ELSE 0 END)
    + (CASE WHEN ci.kind IN ('question', 'resource', 'announcement') THEN ${w.academic} ELSE 0 END)
    + (CASE WHEN ci.knowledge_type IS NOT NULL THEN ${w.classified} ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM content_sources cs WHERE cs.content_id = ci.id)
            THEN ${w.sourced} ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM content_corrections cc
                         WHERE cc.content_id = ci.id AND cc.status = 'proposed')
            THEN ${w.disputed} ELSE 0 END)
    + (CASE WHEN ci.author_id = ANY($9::uuid[]) THEN 1.0 ELSE 0.0 END) * ${w.social}
    + ln(1 + ci.like_count + ci.comment_count * 2) * ${w.engagement}
    + exp(
        -(GREATEST(0, EXTRACT(EPOCH FROM (${w.now} - ci.created_at)) / 3600.0))
        * ln(2) / ${w.halfLife}
      ) * ${w.recency}
  ) * (CASE WHEN sig.seen THEN ${w.seenPenalty} ELSE 1.0 END)`;
}

/**
 * Author, academic context, container, viewer state, media and topics.
 *
 * Shared verbatim between the feed and the single-item read so the two can
 * never return differently-shaped content — a client that has to handle two
 * shapes for the same object will eventually mishandle one.
 *
 * Assumes a `scored s` relation is in scope and that $1 is the viewer id.
 */
export const ENRICHMENT_SELECT = `    SELECT
      s.*,
      p.handle          AS author_handle,
      p.display_name    AS author_display_name,
      p.avatar_url      AS author_avatar_url,
      au.verification_level AS author_verification_level,
      st.name_ar        AS author_stage_name_ar,
      st.name_en        AS author_stage_name_en,
      co.name_ar        AS author_college_name_ar,
      co.name_en        AS author_college_name_en,
      c.name_ar         AS course_name_ar,
      c.name_en         AS course_name_en,
      sub.name_ar       AS subject_name_ar,
      sub.name_en       AS subject_name_en,
      comm.name_ar      AS community_name_ar,
      comm.name_en      AS community_name_en,
      g.name            AS group_name,
      (SELECT r.kind FROM reactions r
         WHERE r.content_id = s.id AND r.user_id = $1::uuid) AS viewer_reaction,
      EXISTS (SELECT 1 FROM bookmarks b
         WHERE b.content_id = s.id AND b.user_id = $1::uuid) AS viewer_bookmarked,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'id', f.id, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes,
                 'width', f.metadata->'width', 'height', f.metadata->'height'
               ) ORDER BY cm.ordinal)
        FROM content_media cm
        JOIN files f ON f.id = cm.file_id AND f.deleted_at IS NULL
        WHERE cm.content_id = s.id
      ), '[]'::json) AS media,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'id', t.id, 'nameAr', t.name_ar, 'nameEn', t.name_en
               ) ORDER BY t.name_en)
        FROM content_topics ct
        JOIN topics t ON t.id = ct.topic_id
        WHERE ct.content_id = s.id
      ), '[]'::json) AS topics
    FROM scored s
    JOIN profiles p ON p.user_id = s.author_id
    JOIN users au ON au.id = s.author_id
    LEFT JOIN stages st ON st.id = p.stage_id
    LEFT JOIN colleges co ON co.id = p.college_id
    LEFT JOIN courses c ON c.id = s.course_id
    LEFT JOIN subjects sub ON sub.id = s.subject_id
    LEFT JOIN communities comm ON comm.id = s.community_id
    LEFT JOIN groups g ON g.id = s.group_id`;

export interface BuiltQuery {
  text: string;
  params: unknown[];
}

export function buildFeedQuery(options: FeedQueryOptions): BuiltQuery {
  const { scopes, pinnedNow, limit, cursor, ordering, filters, applyMutes } = options;

  const params: unknown[] = [
    scopes.userId,
    scopes.universityId,
    scopes.collegeId,
    scopes.stageId,
    scopes.courseIds,
    scopes.communityIds,
    scopes.groupIds,
    scopes.classroomIds,
    scopes.followingIds,
    scopes.excludedUserIds,
  ];

  const weightBase = SCOPE_PARAM_COUNT;
  params.push(
    FEED_WEIGHTS.enrolledCourse,
    FEED_WEIGHTS.weakTopic,
    FEED_WEIGHTS.interestTopic,
    FEED_WEIGHTS.cohort,
    FEED_WEIGHTS.academicKind,
    FEED_WEIGHTS.social,
    FEED_WEIGHTS.engagement,
    FEED_WEIGHTS.recency,
    FEED_WEIGHTS.seenPenalty,
    RECENCY_HALF_LIFE_HOURS,
    pinnedNow,
    FEED_WEIGHTS.classified,
    FEED_WEIGHTS.sourced,
    FEED_WEIGHTS.disputed,
  );

  const conditions: string[] = [
    'ci.deleted_at IS NULL',
    'u.deleted_at IS NULL',
    // `suspended` belongs here with `banned` and `deleted`: a suspension that
    // left the account's posts in every cohort feed would be a suspension in
    // name only. `restricted` does NOT belong here — restriction removes the
    // ability to write, it does not retract what was already written. The same
    // list is in `authorIsWithheld` in @sos/core, which the single-item read
    // uses, so the two surfaces cannot disagree.
    "u.status NOT IN ('suspended', 'banned', 'deleted')",
    // Blocking is bidirectional and applied here rather than after the fetch,
    // so a blocked author's posts never occupy a slot in the page.
    'NOT (ci.author_id = ANY($10::uuid[]))',
    visibilityPredicate(),
  ];

  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  /*
   * Mutes, filtered in the query for the same reason blocks are: a mute applied
   * after the fetch returns short pages and lets the reader infer, from the gap,
   * exactly what they asked not to see.
   *
   * The author's own posts are never muted away — muting someone does not
   * un-publish yourself — and a topic mute matches if ANY topic on the post is
   * muted, which is the reading a student expects from "mute this topic".
   */
  if (applyMutes) {
    if (scopes.mutedUserIds.length > 0) {
      conditions.push(
        `(ci.author_id = $1::uuid OR NOT (ci.author_id = ANY(${push(scopes.mutedUserIds)}::uuid[])))`,
      );
    }
    if (scopes.mutedGroupIds.length > 0) {
      conditions.push(
        `(ci.group_id IS NULL OR NOT (ci.group_id = ANY(${push(scopes.mutedGroupIds)}::uuid[])))`,
      );
    }
    if (scopes.mutedCommunityIds.length > 0) {
      conditions.push(
        `(ci.community_id IS NULL OR NOT (ci.community_id = ANY(${push(
          scopes.mutedCommunityIds,
        )}::uuid[])))`,
      );
    }
    if (scopes.mutedTopicIds.length > 0) {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM content_topics mt
                     WHERE mt.content_id = ci.id
                       AND mt.topic_id = ANY(${push(scopes.mutedTopicIds)}::uuid[]))`,
      );
    }
  }

  if (filters.authorId) conditions.push(`ci.author_id = ${push(filters.authorId)}::uuid`);
  if (filters.courseId) conditions.push(`ci.course_id = ${push(filters.courseId)}::uuid`);
  if (filters.communityId) conditions.push(`ci.community_id = ${push(filters.communityId)}::uuid`);
  if (filters.groupId) conditions.push(`ci.group_id = ${push(filters.groupId)}::uuid`);
  if (filters.topicId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM content_topics ct WHERE ct.content_id = ci.id AND ct.topic_id = ${push(
        filters.topicId,
      )}::uuid)`,
    );
  }
  if (filters.knowledgeType) {
    conditions.push(`ci.knowledge_type = ${push(filters.knowledgeType)}::knowledge_type`);
  }
  if (filters.difficulty) {
    conditions.push(`ci.difficulty = ${push(filters.difficulty)}::difficulty_level`);
  }
  if (filters.language) {
    conditions.push(`ci.language = ${push(filters.language)}`);
  }
  if (filters.bookmarkedBy) {
    conditions.push(
      `EXISTS (SELECT 1 FROM bookmarks bm WHERE bm.content_id = ci.id AND bm.user_id = ${push(
        filters.bookmarkedBy,
      )}::uuid)`,
    );
  }

  const score = scoreExpression(weightBase);

  // Signals are computed once in a lateral join so the score expression and the
  // returned row read the same values rather than re-evaluating subqueries.
  const text = `
    WITH scored AS (
      SELECT
        ci.id,
        ci.kind,
        ci.knowledge_type,
        ci.difficulty,
        ci.language,
        ci.author_id,
        ci.body,
        ci.visibility,
        ci.course_id,
        ci.subject_id,
        ci.community_id,
        ci.group_id,
        ci.classroom_id,
        ci.like_count,
        ci.comment_count,
        ci.bookmark_count,
        ci.view_count,
        ci.is_pinned,
        ci.edited_at,
        ci.created_at,
        sig.seen,
        ${score} AS score
      FROM content_items ci
      JOIN users u ON u.id = ci.author_id
      CROSS JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM content_views cv
            WHERE cv.content_id = ci.id AND cv.user_id = $1::uuid
          ) AS seen,
          EXISTS (
            SELECT 1 FROM content_topics ct
            JOIN profile_interests pi ON pi.topic_id = ct.topic_id AND pi.user_id = $1::uuid
            WHERE ct.content_id = ci.id
          ) AS matches_interest_topic,
          EXISTS (
            SELECT 1 FROM content_topics ct
            JOIN learning_progress lp ON lp.topic_id = ct.topic_id AND lp.user_id = $1::uuid
            WHERE ct.content_id = ci.id AND lp.weakness_score >= 0.5
          ) AS matches_weak_topic
      ) sig
      WHERE ${conditions.join('\n        AND ')}
    )
    ${ENRICHMENT_SELECT}
    ${cursorClause(ordering, cursor, push)}
    ORDER BY ${ordering === 'rank' ? 's.score DESC, s.id DESC' : 's.created_at DESC, s.id DESC'}
    LIMIT ${push(limit + 1)}
  `;

  return { text, params };
}

/**
 * Keyset pagination.
 *
 * Row-value comparison (`(a, b) < (x, y)`) rather than `a < x OR (a = x AND
 * b < y)`: same semantics, and Postgres can use it directly against a composite
 * ordering. The tiebreak on `id` is what makes the boundary total — without it,
 * two rows with an identical score straddle the page edge and one is lost.
 */
function cursorClause(
  ordering: 'rank' | 'recent',
  cursor: FeedQueryOptions['cursor'],
  push: (value: unknown) => string,
): string {
  if (!cursor) return '';
  if (ordering === 'rank' && 'score' in cursor) {
    return `WHERE (s.score, s.id) < (${push(cursor.score)}::float8, ${push(cursor.id)}::uuid)`;
  }
  if (ordering === 'recent' && 'createdAt' in cursor) {
    return `WHERE (s.created_at, s.id) < (${push(new Date(cursor.createdAt))}::timestamptz, ${push(
      cursor.id,
    )}::uuid)`;
  }
  return '';
}

/**
 * Single-item read.
 *
 * Carries NO permission predicate on purpose. Single-object access is decided
 * by `canViewContent` in the service — which, unlike the feed, does honour the
 * platform-admin bypass so moderation can open a reported item. Keeping the two
 * paths distinct is what lets the feed stay a product surface and the item read
 * be a moderation-capable one.
 */
export function buildContentByIdQuery(contentId: string, viewerId: string | null): BuiltQuery {
  const text = `
    WITH scored AS (
      SELECT
        ci.id, ci.kind, ci.knowledge_type, ci.difficulty, ci.language,
        ci.author_id, ci.body, ci.visibility, ci.course_id,
        ci.subject_id, ci.community_id, ci.group_id, ci.classroom_id,
        ci.like_count, ci.comment_count, ci.bookmark_count, ci.view_count,
        ci.is_pinned, ci.edited_at, ci.created_at,
        EXISTS (
          SELECT 1 FROM content_views cv
          WHERE cv.content_id = ci.id AND cv.user_id = $1::uuid
        ) AS seen,
        0::float8 AS score
      FROM content_items ci
      WHERE ci.id = $2::uuid AND ci.deleted_at IS NULL
    )
    ${ENRICHMENT_SELECT}
  `;
  return { text, params: [viewerId, contentId] };
}
