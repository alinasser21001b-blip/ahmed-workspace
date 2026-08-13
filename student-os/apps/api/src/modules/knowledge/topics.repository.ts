import type { KnowledgeType, TopicRelation } from '@sos/contracts';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Topics as a navigation primitive.
 *
 * A topic is where knowledge accumulates: the same explanation is reachable
 * from the feed today and from its topic six months from now, which is the
 * difference between this product and a timeline.
 */

export interface TopicRow {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  subject_id: string;
  subject_name_ar: string;
  subject_name_en: string;
  course_id: string;
  course_name_ar: string;
  course_name_en: string;
  parent_topic_id: string | null;
  parent_name_ar: string | null;
  parent_name_en: string | null;
}

const TOPIC_SELECT = `
  SELECT t.id, t.slug, t.name_ar, t.name_en,
         t.subject_id, s.name_ar AS subject_name_ar, s.name_en AS subject_name_en,
         s.course_id, c.name_ar AS course_name_ar, c.name_en AS course_name_en,
         t.parent_topic_id, pt.name_ar AS parent_name_ar, pt.name_en AS parent_name_en
  FROM topics t
  JOIN subjects s ON s.id = t.subject_id
  JOIN courses c ON c.id = s.course_id
  LEFT JOIN topics pt ON pt.id = t.parent_topic_id
`;

export async function findTopic(topicId: string, client?: Sql): Promise<TopicRow | null> {
  return queryOne<TopicRow>(`${TOPIC_SELECT} WHERE t.id = $1`, [topicId], client);
}

export async function listSubtopics(
  topicId: string,
  client?: Sql,
): Promise<{ id: string; name_ar: string; name_en: string }[]> {
  return queryRows(
    `SELECT id, name_ar, name_en FROM topics WHERE parent_topic_id = $1 ORDER BY ordinal, name_en`,
    [topicId],
    client,
  );
}

export interface RelatedTopicRow {
  id: string;
  name_ar: string;
  name_en: string;
  subject_name_ar: string | null;
  subject_name_en: string | null;
  relation: TopicRelation;
  source: 'curated' | 'derived';
  strength: number | null;
}

export async function listRelated(
  topicId: string,
  limit: number,
  client?: Sql,
): Promise<RelatedTopicRow[]> {
  return queryRows<RelatedTopicRow>(
    `SELECT t.id, t.name_ar, t.name_en,
            s.name_ar AS subject_name_ar, s.name_en AS subject_name_en,
            r.relation, r.source, r.strength
     FROM topic_relations r
     JOIN topics t ON t.id = r.to_topic_id
     JOIN subjects s ON s.id = t.subject_id
     WHERE r.from_topic_id = $1
     ORDER BY r.source = 'curated' DESC, r.strength DESC NULLS LAST, t.name_en
     LIMIT $2`,
    [topicId, limit],
    client,
  );
}

/**
 * How much visible knowledge of each type this topic holds.
 *
 * The permission predicate is a **verbatim transcription of the feed's**, and
 * that is not laziness: a count that includes content the reader cannot open
 * tells them a private group's post exists. Counts leak just as surely as rows.
 */
export async function knowledgeCounts(
  topicId: string,
  scopes: {
    userId: string;
    universityId: string | null;
    collegeId: string | null;
    stageId: string | null;
    courseIds: string[];
    communityIds: string[];
    groupIds: string[];
    classroomIds: string[];
    followingIds: string[];
    excludedUserIds: string[];
  },
  client?: Sql,
): Promise<{ knowledge_type: KnowledgeType; count: string }[]> {
  return queryRows(
    `SELECT ci.knowledge_type, count(*)::text AS count
     FROM content_items ci
     JOIN content_topics ct ON ct.content_id = ci.id AND ct.topic_id = $10
     JOIN users u ON u.id = ci.author_id
     WHERE ci.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND u.status NOT IN ('suspended', 'banned', 'deleted')
       AND ci.knowledge_type IS NOT NULL
       AND NOT (ci.author_id = ANY($9::uuid[]))
       AND (
         ci.author_id = $1::uuid
         OR (
           (ci.group_id IS NULL OR ci.group_id = ANY($6::uuid[]))
           AND (ci.classroom_id IS NULL OR ci.classroom_id = ANY($7::uuid[]))
           AND (ci.community_id IS NULL OR ci.visibility <> 'community'
                OR ci.community_id = ANY($5::uuid[]))
           AND (
             ci.visibility = 'public'
             OR (ci.visibility = 'university' AND ci.university_id = $2::uuid)
             OR (ci.visibility = 'college'    AND ci.college_id = $3::uuid)
             OR (ci.visibility = 'stage'      AND ci.college_id = $3::uuid AND ci.stage_id = $4::uuid)
             OR (ci.visibility = 'course'     AND ci.course_id = ANY($11::uuid[]))
             OR (ci.visibility = 'community'  AND ci.community_id = ANY($5::uuid[]))
             OR (ci.visibility = 'group'      AND ci.group_id = ANY($6::uuid[]))
             OR (ci.visibility = 'classroom'  AND ci.classroom_id = ANY($7::uuid[]))
             OR (ci.visibility = 'followers'  AND ci.author_id = ANY($8::uuid[]))
           )
         )
       )
     GROUP BY ci.knowledge_type
     ORDER BY count(*) DESC`,
    [
      scopes.userId,
      scopes.universityId,
      scopes.collegeId,
      scopes.stageId,
      scopes.communityIds,
      scopes.groupIds,
      scopes.classroomIds,
      scopes.followingIds,
      scopes.excludedUserIds,
      topicId,
      scopes.courseIds,
    ],
    client,
  );
}

/** This reader's own learning signal for the topic, if any. */
export async function viewerProgress(
  userId: string,
  topicId: string,
  client?: Sql,
): Promise<{
  questions_seen: number;
  questions_correct: number;
  weakness_score: number | null;
  last_activity_at: Date | null;
  is_interest: boolean;
} | null> {
  return queryOne(
    `SELECT COALESCE(lp.questions_seen, 0) AS questions_seen,
            COALESCE(lp.questions_correct, 0) AS questions_correct,
            lp.weakness_score,
            lp.last_activity_at,
            EXISTS (SELECT 1 FROM profile_interests pi
                    WHERE pi.user_id = $1 AND pi.topic_id = $2) AS is_interest
     FROM (SELECT 1) dummy
     LEFT JOIN learning_progress lp ON lp.user_id = $1 AND lp.topic_id = $2`,
    [userId, topicId],
    client,
  );
}

// --- derived relations ------------------------------------------------------

/**
 * Rebuilds the derived topic graph from co-tagging.
 *
 * This is the product's first piece of intelligence, and it is arithmetic:
 * two topics that appear together on the cohort's own content are related, and
 * how often is the strength. No model, no embedding, and explainable to a
 * student in one sentence — *these appear together in your cohort's notes.*
 *
 * Symmetric, because "related" has no direction: both (a,b) and (b,a) are
 * written so the topic page needs one indexed lookup rather than a union.
 *
 * Curated edges are never touched. A person asserting a prerequisite is a
 * different claim from a count, and the refresh must not overwrite it
 * (ADR-0013).
 */
export async function refreshDerivedRelations(
  options: { minCoOccurrence: number; maxPerTopic: number },
  client?: Sql,
): Promise<number> {
  await queryOne(`DELETE FROM topic_relations WHERE source = 'derived'`, [], client);

  const row = await queryOne<{ inserted: string }>(
    `WITH pairs AS (
       SELECT a.topic_id AS from_topic_id,
              b.topic_id AS to_topic_id,
              count(*)::real AS strength
       FROM content_topics a
       JOIN content_topics b ON b.content_id = a.content_id AND b.topic_id <> a.topic_id
       JOIN content_items ci ON ci.id = a.content_id AND ci.deleted_at IS NULL
       GROUP BY a.topic_id, b.topic_id
       HAVING count(*) >= $1
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY from_topic_id ORDER BY strength DESC) AS rank
       FROM pairs
     ), inserted AS (
       INSERT INTO topic_relations (from_topic_id, to_topic_id, relation, source, strength)
       SELECT from_topic_id, to_topic_id, 'related', 'derived', strength
       FROM ranked
       WHERE rank <= $2
       -- A curated edge for the same pair wins; the refresh never overwrites a
       -- person's assertion with a count.
       ON CONFLICT (from_topic_id, to_topic_id, relation) DO NOTHING
       RETURNING 1
     )
     SELECT count(*)::text AS inserted FROM inserted`,
    [options.minCoOccurrence, options.maxPerTopic],
    client,
  );

  return Number(row?.inserted ?? 0);
}

// --- the Learn surface ------------------------------------------------------

export interface LearnProgressRow {
  topic_id: string;
  name_ar: string;
  name_en: string;
  subject_name_ar: string;
  subject_name_en: string;
  questions_seen: number;
  questions_correct: number;
  weakness_score: number | null;
  last_activity_at: Date | null;
}

/**
 * The student's own progress rows, weakest first.
 *
 * Ordered by the stored `weakness_score` because ordering has to happen in SQL,
 * but the number the client is shown is recomputed in the service from the raw
 * counts — a row written before the formula changed must not silently
 * misreport.
 */
export async function listLearnProgress(
  userId: string,
  limit: number,
  client?: Sql,
): Promise<LearnProgressRow[]> {
  return queryRows<LearnProgressRow>(
    `SELECT lp.topic_id, t.name_ar, t.name_en,
            s.name_ar AS subject_name_ar, s.name_en AS subject_name_en,
            lp.questions_seen, lp.questions_correct, lp.weakness_score, lp.last_activity_at
     FROM learning_progress lp
     JOIN topics t ON t.id = lp.topic_id
     JOIN subjects s ON s.id = t.subject_id
     WHERE lp.user_id = $1
     ORDER BY lp.weakness_score DESC NULLS LAST, lp.last_activity_at DESC NULLS LAST
     LIMIT $2`,
    [userId, limit],
    client,
  );
}

/** Declared interests — the cold-start input, before any activity exists. */
export async function listInterestTopics(
  userId: string,
  limit: number,
  client?: Sql,
): Promise<{ id: string; name_ar: string; name_en: string }[]> {
  return queryRows<{ id: string; name_ar: string; name_en: string }>(
    `SELECT t.id, t.name_ar, t.name_en
     FROM profile_interests pi
     JOIN topics t ON t.id = pi.topic_id
     WHERE pi.user_id = $1
     ORDER BY t.name_en
     LIMIT $2`,
    [userId, limit],
    client,
  );
}

export async function countBookmarks(userId: string, client?: Sql): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM bookmarks WHERE user_id = $1`,
    [userId],
    client,
  );
  return Number(row?.n ?? 0);
}

/**
 * The north-star metric, for one student: meaningful learning actions in the
 * last seven days.
 *
 * `is_meaningful` is joined from the reference table rather than hardcoded, so
 * the definition stays a row (ADR-0014) and this query does not change when it
 * moves.
 */
export async function countMeaningfulActions(
  userId: string,
  days: number,
  client?: Sql,
): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM learning_events le
     JOIN learning_event_kinds k ON k.kind = le.kind AND k.is_meaningful
     WHERE le.user_id = $1 AND le.occurred_at > now() - make_interval(days => $2)`,
    [userId, days],
    client,
  );
  return Number(row?.n ?? 0);
}
