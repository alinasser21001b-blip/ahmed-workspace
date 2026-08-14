import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Practice persistence. SQL only.
 *
 * Two rules from ADR-0003 hold here without exception.
 *
 * 1. **The permission predicate is in the WHERE clause.** Nothing is fetched
 *    and then discarded. `findPracticableQuiz` and `lockAttempt` both carry
 *    their scope inline, so an attempt that belongs to another student is not
 *    "found and rejected" — it is not found.
 *
 * 2. **Correctness never leaves this file for the client.** `listSessionQuestions`
 *    selects labels and no `is_correct`; the key is read only by
 *    `findGradableQuestion`, which the service calls after an answer arrives
 *    and whose result goes to `@sos/core` to be graded.
 *
 * The practice scope is deliberately narrower than the content feed's. A quiz
 * is practicable when it is published and belongs to a course the student is
 * enrolled in — full stop. Quizzes pinned to a classroom or a group are
 * excluded outright rather than half-checked against a second transcription of
 * the container rules, because a second transcription is the thing that
 * eventually disagrees with the first. Widening this is a deliberate later
 * decision with its own tests, not an omission.
 */

const PRACTICABLE_QUIZ = `
  q.deleted_at IS NULL
  AND q.published_at IS NOT NULL
  AND q.course_id = ANY($1::uuid[])
  AND q.classroom_id IS NULL
  AND q.group_id IS NULL
`;

/**
 * Kinds a practice session may contain.
 *
 * `short_answer` is filtered out in SQL rather than in the client: a question
 * the server would refuse to grade must never appear in a session, or the
 * student answers it and the loop silently drops the observation.
 */
const GRADABLE_KINDS = `('mcq_single', 'mcq_multi', 'true_false')`;

export interface PracticableQuiz {
  quiz_id: string;
  quiz_title: string;
  topic_id: string;
  topic_name_ar: string;
  topic_name_en: string | null;
  question_count: number;
}

/**
 * The one quiz this student will practise for this topic.
 *
 * A topic's questions can be spread across several quizzes, and an attempt in
 * this schema belongs to exactly one quiz — so a session is one quiz's
 * questions on one topic. The quiz with the most gradable questions on the
 * topic wins, with the most recently published as the tiebreak, so the choice
 * is stable across calls rather than depending on plan order.
 */
export async function findPracticableQuiz(
  courseIds: readonly string[],
  topicId: string,
  client?: Sql,
): Promise<PracticableQuiz | null> {
  return queryOne<PracticableQuiz>(
    `SELECT q.id            AS quiz_id,
            q.title         AS quiz_title,
            t.id            AS topic_id,
            t.name_ar       AS topic_name_ar,
            t.name_en       AS topic_name_en,
            count(qq.id)::int AS question_count
     FROM quizzes q
     JOIN quiz_questions qq
       ON qq.quiz_id = q.id
      AND qq.topic_id = $2::uuid
      AND qq.kind IN ${GRADABLE_KINDS}
     JOIN topics t ON t.id = qq.topic_id
     WHERE ${PRACTICABLE_QUIZ}
     GROUP BY q.id, q.title, q.published_at, t.id, t.name_ar, t.name_en
     ORDER BY count(qq.id) DESC, q.published_at DESC, q.id
     LIMIT 1`,
    [courseIds, topicId],
    client,
  );
}

/**
 * Whether this student has anything to practise on this topic.
 *
 * `EXISTS` rather than a reuse of `findPracticableQuiz`: the topic page asks
 * this on every load only to decide whether to draw a button, and it does not
 * need the winning quiz, its title or its question count. Same predicate, so
 * the button cannot disagree with the route behind it.
 */
export async function hasPracticableQuestions(
  courseIds: readonly string[],
  topicId: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM quizzes q
       JOIN quiz_questions qq
         ON qq.quiz_id = q.id
        AND qq.topic_id = $2::uuid
        AND qq.kind IN ${GRADABLE_KINDS}
       WHERE ${PRACTICABLE_QUIZ}
     ) AS ok`,
    [courseIds, topicId],
    client,
  );
  return row?.ok ?? false;
}

/**
 * The student's open attempt on this quiz FOR THIS TOPIC, or a new one.
 *
 * `quiz_attempts_one_active` (0005) is a unique index on (quiz_id, user_id)
 * where status = 'in_progress', so this is an upsert against that constraint
 * rather than a select-then-insert: two cold taps on "Practice" from the same
 * student cannot produce two attempts. `DO UPDATE` on a no-op column is what
 * makes `RETURNING` yield the existing row — `DO NOTHING` would return none and
 * force a second round trip.
 *
 * The topic is part of the attempt's identity (0014), and an open attempt for a
 * DIFFERENT topic of the same quiz is not resumable from here: resuming it
 * would either serve Topic B questions under an attempt started for Topic A, or
 * silently re-point the attempt mid-flight so one attempt mutates two topics'
 * progress. It is closed as `abandoned` — its answered questions already rolled
 * up, nothing is lost — and a fresh attempt is opened for the topic actually
 * asked for. The upsert's `DO UPDATE` row lock is what makes the
 * abandon-then-insert race-free: a concurrent start holds the same row.
 */
export async function startOrResumeAttempt(
  input: { quizId: string; userId: string; topicId: string },
  client: Sql,
): Promise<{ id: string; is_new: boolean }> {
  const row = await queryOne<{ id: string; topic_id: string | null; is_new: boolean }>(
    `INSERT INTO quiz_attempts (quiz_id, user_id, topic_id, status)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT (quiz_id, user_id) WHERE status = 'in_progress'
       DO UPDATE SET quiz_id = EXCLUDED.quiz_id
     RETURNING id, topic_id, (xmax = 0) AS is_new`,
    [input.quizId, input.userId, input.topicId],
    client,
  );

  if (!row!.is_new && row!.topic_id !== input.topicId) {
    await queryOne(
      `UPDATE quiz_attempts SET status = 'abandoned' WHERE id = $1 RETURNING id`,
      [row!.id],
      client,
    );
    const fresh = await queryOne<{ id: string }>(
      `INSERT INTO quiz_attempts (quiz_id, user_id, topic_id, status)
       VALUES ($1, $2, $3, 'in_progress')
       RETURNING id`,
      [input.quizId, input.userId, input.topicId],
      client,
    );
    return { id: fresh!.id, is_new: true };
  }

  return { id: row!.id, is_new: row!.is_new };
}

export interface SessionQuestionRow {
  id: string;
  kind: 'mcq_single' | 'mcq_multi' | 'true_false';
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  answered: boolean;
  options: { id: string; label: string }[];
}

/**
 * The questions of one attempt, with options and WITHOUT the key.
 *
 * `is_correct` is not in the projection at all. Excluding it in the query
 * rather than deleting it in the service means a future refactor of the mapping
 * layer cannot accidentally start shipping the answers.
 */
export async function listSessionQuestions(
  input: { quizId: string; topicId: string; attemptId: string },
  client?: Sql,
): Promise<SessionQuestionRow[]> {
  return queryRows<SessionQuestionRow>(
    `SELECT qq.id,
            qq.kind::text AS kind,
            qq.prompt,
            qq.difficulty::text AS difficulty,
            qq.points,
            EXISTS (
              SELECT 1 FROM quiz_answers qa
              WHERE qa.attempt_id = $3::uuid AND qa.question_id = qq.id
            ) AS answered,
            COALESCE(
              (SELECT json_agg(json_build_object('id', o.id, 'label', o.label) ORDER BY o.ordinal, o.id)
               FROM quiz_options o WHERE o.question_id = qq.id),
              '[]'::json
            ) AS options
     FROM quiz_questions qq
     WHERE qq.quiz_id = $1::uuid
       AND qq.topic_id = $2::uuid
       AND qq.kind IN ${GRADABLE_KINDS}
     ORDER BY qq.ordinal, qq.id`,
    [input.quizId, input.topicId, input.attemptId],
    client,
  );
}

export interface AttemptRow {
  id: string;
  quiz_id: string;
  topic_id: string | null;
  status: 'in_progress' | 'submitted';
}

/**
 * Locks the student's own attempt for the duration of a submission.
 *
 * Ownership is part of the predicate, not a check afterwards: another student's
 * attempt id returns null and the service raises a 404, so the response cannot
 * confirm that the attempt exists.
 *
 * `submitted` attempts ARE matched, on purpose. The final answer of a set both
 * writes the answer and closes the attempt in one transaction — so when that
 * response is lost on the wire and the client retries, the retry arrives at a
 * submitted attempt. Matching it is what lets the service return the stored
 * verdict instead of a 404 for a request that already succeeded. What a
 * submitted attempt never does is accept a NEW answer; the service enforces
 * that from the `status` returned here. `abandoned` attempts are not matched:
 * they were closed unanswered, and nothing about them was ever acknowledged.
 *
 * `FOR UPDATE` is what makes two simultaneous submissions of the same answer
 * serialise. Without it both transactions read "not yet answered", both grade,
 * and the second's `ON CONFLICT DO NOTHING` silently discards its insert — but
 * only after both have already incremented `learning_progress`.
 */
export async function lockAttempt(
  input: { attemptId: string; userId: string },
  client: Sql,
): Promise<AttemptRow | null> {
  return queryOne<AttemptRow>(
    `SELECT id, quiz_id, topic_id, status::text AS status
     FROM quiz_attempts
     WHERE id = $1::uuid AND user_id = $2::uuid AND status IN ('in_progress', 'submitted')
     FOR UPDATE`,
    [input.attemptId, input.userId],
    client,
  );
}

export interface GradableQuestionRow {
  id: string;
  kind: 'mcq_single' | 'mcq_multi' | 'true_false';
  points: number;
  topic_id: string | null;
  explanation: string | null;
  correct_option_ids: string[];
}

/**
 * A question with its key, for grading.
 *
 * Scoped to the attempt's quiz AND the attempt's topic. The quiz scope stops a
 * question id borrowed from another quiz; the topic scope stops the subtler
 * attack the quiz scope alone permits — a quiz whose questions span Topics A
 * and B, where an attempt started for A is handed a perfectly valid question id
 * from B. Both resolve to nothing rather than to a refusal, so neither probe
 * learns that the id was real.
 *
 * A null `topicId` (an attempt from before 0014) applies no topic restriction,
 * which is the behaviour those attempts had when they were created.
 */
export async function findGradableQuestion(
  input: { quizId: string; topicId: string | null; questionId: string },
  client: Sql,
): Promise<GradableQuestionRow | null> {
  return queryOne<GradableQuestionRow>(
    `SELECT qq.id,
            qq.kind::text AS kind,
            qq.points,
            qq.topic_id,
            qq.explanation,
            COALESCE(
              (SELECT array_agg(o.id ORDER BY o.ordinal, o.id)
               FROM quiz_options o WHERE o.question_id = qq.id AND o.is_correct),
              '{}'::uuid[]
            ) AS correct_option_ids
     FROM quiz_questions qq
     WHERE qq.id = $2::uuid
       AND qq.quiz_id = $1::uuid
       AND ($3::uuid IS NULL OR qq.topic_id = $3::uuid)
       AND qq.kind IN ${GRADABLE_KINDS}`,
    [input.quizId, input.questionId, input.topicId],
    client,
  );
}

/**
 * Records the observation, once.
 *
 * The primary key `(attempt_id, question_id)` is the idempotency guard, and it
 * is the database's rather than the service's on purpose: a check-then-insert
 * in application code has a window between the two, and this is the row every
 * progress mutation downstream must be traceable to.
 *
 * A null return means the answer already existed and nothing was written —
 * which is the service's signal to leave every counter alone.
 */
export async function insertAnswerOnce(
  input: {
    attemptId: string;
    questionId: string;
    selectedOptionIds: readonly string[];
    isCorrect: boolean;
    pointsAwarded: number;
  },
  client: Sql,
): Promise<{ is_correct: boolean; points_awarded: string } | null> {
  return queryOne<{ is_correct: boolean; points_awarded: string }>(
    `INSERT INTO quiz_answers
       (attempt_id, question_id, selected_option_ids, is_correct, points_awarded)
     VALUES ($1, $2, $3::uuid[], $4, $5)
     ON CONFLICT (attempt_id, question_id) DO NOTHING
     RETURNING is_correct, points_awarded::text AS points_awarded`,
    [
      input.attemptId,
      input.questionId,
      input.selectedOptionIds,
      input.isCorrect,
      input.pointsAwarded,
    ],
    client,
  );
}

/** The stored verdict for an answer that was submitted twice. */
export async function findStoredAnswer(
  input: { attemptId: string; questionId: string },
  client: Sql,
): Promise<{ is_correct: boolean; points_awarded: string } | null> {
  return queryOne<{ is_correct: boolean; points_awarded: string }>(
    `SELECT is_correct, points_awarded::text AS points_awarded
     FROM quiz_answers
     WHERE attempt_id = $1::uuid AND question_id = $2::uuid`,
    [input.attemptId, input.questionId],
    client,
  );
}

/** How much of the attempt's topic set is done. */
export async function attemptCompletion(
  input: { attemptId: string; quizId: string; topicId: string },
  client: Sql,
): Promise<{ answered: number; total: number }> {
  const row = await queryOne<{ answered: number; total: number }>(
    `SELECT count(*) FILTER (WHERE qa.attempt_id IS NOT NULL)::int AS answered,
            count(*)::int AS total
     FROM quiz_questions qq
     LEFT JOIN quiz_answers qa ON qa.question_id = qq.id AND qa.attempt_id = $1::uuid
     WHERE qq.quiz_id = $2::uuid
       AND qq.topic_id = $3::uuid
       AND qq.kind IN ${GRADABLE_KINDS}`,
    [input.attemptId, input.quizId, input.topicId],
    client,
  );
  return row ?? { answered: 0, total: 0 };
}

/** Closes the attempt and stamps its score. Idempotent by the status guard. */
export async function submitAttempt(attemptId: string, client: Sql): Promise<void> {
  await queryOne(
    `UPDATE quiz_attempts a
     SET status = 'submitted',
         submitted_at = now(),
         score = totals.score,
         max_score = totals.max_score,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - a.started_at))::int)
     FROM (
       SELECT COALESCE(sum(qa.points_awarded), 0) AS score,
              COALESCE(sum(qq.points), 0)          AS max_score
       FROM quiz_answers qa
       JOIN quiz_questions qq ON qq.id = qa.question_id
       WHERE qa.attempt_id = $1::uuid
     ) totals
     WHERE a.id = $1::uuid AND a.status = 'in_progress'`,
    [attemptId],
    client,
  );
}

/** The student's current signal for a topic, for a session that has not written yet. */
export async function findTopicProgress(
  input: { userId: string; topicId: string },
  client?: Sql,
): Promise<{
  questions_seen: number;
  questions_correct: number;
  last_activity_at: Date | null;
} | null> {
  return queryOne(
    `SELECT questions_seen, questions_correct, last_activity_at
     FROM learning_progress
     WHERE user_id = $1::uuid AND topic_id = $2::uuid`,
    [input.userId, input.topicId],
    client,
  );
}
