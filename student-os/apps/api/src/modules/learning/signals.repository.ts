import { queryOne, type Sql } from '../../platform/db.js';

/**
 * Learning-signal persistence. SQL only.
 *
 * The single-insert-path rule lives one layer up, in `signals.service`: the
 * plain per-event insert is NOT duplicated here, because that path belongs to
 * `events.repository` and having two would defeat the taxonomy guard. What is
 * here is the SQL that genuinely has no other home — the fan-out across a
 * content item's topics, and the two `learning_progress` upserts.
 */

/**
 * One row per topic the content is tagged with, in a single statement.
 *
 * The join is a `LEFT JOIN` on purpose: untagged content still produces one
 * context-free row, so a classification gap does not silently erase a student's
 * activity. The `EXISTS` clause is the same taxonomy guard the plain insert
 * uses — an unknown kind writes nothing rather than failing the caller's
 * transaction.
 */
export async function insertLearningEventPerTopic(
  input: {
    userId: string;
    kind: string;
    contentId: string;
    metadata: Record<string, unknown>;
  },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO learning_events
       (user_id, kind, course_id, topic_id, subject_ref_kind, subject_ref_id, metadata)
     SELECT $1, $2, ci.course_id, ct.topic_id, 'content', ci.id, $4::jsonb
     FROM content_items ci
     LEFT JOIN content_topics ct ON ct.content_id = ci.id
     WHERE ci.id = $3
       AND EXISTS (SELECT 1 FROM learning_event_kinds k WHERE k.kind = $2)`,
    [input.userId, input.kind, input.contentId, JSON.stringify(input.metadata)],
    client,
  );
}

export interface TopicProgressRow {
  questions_seen: number;
  questions_correct: number;
  last_activity_at: Date | null;
}

/**
 * Accumulates answer activity for one student on one topic.
 *
 * Returns the row as it now stands. The caller needs those counts immediately —
 * `computeWeakness` runs on them and writes the result back in the same
 * transaction — and `RETURNING` gives them without a second read that could see
 * a different value under a concurrent answer.
 */
export async function upsertTopicProgress(
  input: { userId: string; topicId: string; seen: number; correct: number },
  client?: Sql,
): Promise<TopicProgressRow> {
  const row = await queryOne<TopicProgressRow>(
    `INSERT INTO learning_progress (user_id, topic_id, questions_seen, questions_correct, last_activity_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, topic_id) DO UPDATE SET
       questions_seen    = learning_progress.questions_seen + EXCLUDED.questions_seen,
       questions_correct = learning_progress.questions_correct + EXCLUDED.questions_correct,
       last_activity_at  = now(),
       updated_at        = now()
     RETURNING questions_seen, questions_correct, last_activity_at`,
    [input.userId, input.topicId, input.seen, input.correct],
    client,
  );
  // The upsert always writes a row; a null here would mean the statement did
  // not run, which is a bug rather than an empty result.
  return row!;
}

/**
 * Writes back a weakness signal.
 *
 * Both numbers are computed by `@sos/core` and passed in. No arithmetic here:
 * a second implementation of the formula is exactly the drift the feed's parity
 * test exists to catch.
 */
export async function updateTopicWeakness(
  input: { userId: string; topicId: string; weaknessScore: number; confidence: number },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE learning_progress
     SET weakness_score = $3, confidence = $4, updated_at = now()
     WHERE user_id = $1 AND topic_id = $2`,
    [input.userId, input.topicId, input.weaknessScore, input.confidence],
    client,
  );
}
