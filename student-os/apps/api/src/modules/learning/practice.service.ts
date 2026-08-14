import type {
  Locale,
  PracticeAnswerResult,
  PracticeSession,
  SubmitPracticeAnswerRequest,
  TopicProgress,
} from '@sos/contracts';
import {
  computeWeakness,
  gradeSelection,
  MIN_QUESTIONS_FOR_CONFIDENCE,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction, type Sql } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as repo from './practice.repository.js';
import * as signals from './signals.service.js';

/**
 * Practice — the observation half of the learning loop.
 *
 * This is the module the audit found missing. `learning_progress` had three
 * readers and no reachable writer, so `computeWeakness` — a tested formula in
 * `@sos/core` since Phase 0 — always ran over an empty set and always returned
 * zero. Everything the product claims to know about a student traced back to a
 * table nothing wrote.
 *
 * The rules this module exists to keep, all of them enforced here rather than
 * left to callers:
 *
 *  1. **Correctness is decided in one place.** `gradeSelection` in `@sos/core`.
 *     The client never sends a verdict and never sees the key before it
 *     answers. `quiz_answers.is_correct` is written from the grade and nothing
 *     else.
 *  2. **Progress is decided in one place.** `learning_progress` moves only
 *     through `signals.touchTopicProgress`, and only from this module.
 *  3. **Every progress mutation is traceable to an observation.** The
 *     `quiz_answers` row is written first, in the same transaction, and the
 *     counters move only if that insert actually created it. No answer row, no
 *     progress — and a stored answer can always be pointed at as the reason a
 *     number is what it is.
 *  4. **Weakness is not recomputed here.** The formula stays in `@sos/core`;
 *     this module passes the new counts in and writes back what comes out.
 *  5. **Nothing social touches this.** Likes, views, saves and follows do not
 *     reach `learning_progress` and are not consulted. A student's accuracy on
 *     a topic is the only input.
 */

function localised(ar: string, en: string | null, locale: Locale): string {
  return (locale === 'ar' ? ar : (en ?? ar)) || ar;
}

/**
 * Projects the stored counts into what a student is told about themselves.
 *
 * Recomputed from the raw counts rather than read from `weakness_score`, for
 * the same reason the Learn tab recomputes: a row written before the formula
 * changed must not silently misreport. The stored column exists so the feed can
 * ORDER BY and filter in SQL; the number a human sees comes from the function.
 */
function projectProgress(
  topicId: string,
  row: { questions_seen: number; questions_correct: number; last_activity_at: Date | null } | null,
): TopicProgress {
  const signal = computeWeakness({
    topicId,
    questionsSeen: row?.questions_seen ?? 0,
    questionsCorrect: row?.questions_correct ?? 0,
    lastActivityAt: row?.last_activity_at ?? null,
  });
  return {
    topicId,
    questionsSeen: row?.questions_seen ?? 0,
    questionsCorrect: row?.questions_correct ?? 0,
    weaknessScore: signal.weaknessScore,
    confidence: signal.confidence,
    lowConfidence: (row?.questions_seen ?? 0) < MIN_QUESTIONS_FOR_CONFIDENCE,
    lastActivityAt: row?.last_activity_at?.toISOString() ?? null,
  };
}

/**
 * Starts — or resumes — a practice session on a topic.
 *
 * A POST rather than a GET because it creates an attempt and emits
 * `quiz_started`. Resuming is the common case on a second tap, and it returns
 * the same attempt: the unique index on (quiz_id, user_id) where
 * status = 'in_progress' makes a duplicate impossible at the database rather
 * than by convention.
 *
 * 404 when the topic has nothing practicable. Not an empty session with zero
 * questions — the client must be able to tell "no questions exist for you here"
 * from "here is a quiz", and a dead Practice button is the failure mode Phase 3
 * ruled out for every other control.
 */
export async function startSession(
  actor: Actor,
  topicId: string,
  locale: Locale,
): Promise<PracticeSession> {
  const scopes = visibilityScopesFor(actor);
  const quiz = await repo.findPracticableQuiz(scopes.courseIds, topicId);
  if (!quiz) throw errors.notFound('practice');

  return withTransaction(async (client) => {
    const attempt = await repo.startOrResumeAttempt(
      { quizId: quiz.quiz_id, userId: actor.userId, topicId: quiz.topic_id },
      client,
    );

    // Only on a genuinely new attempt. Emitting it on every resume would make
    // "attempts started" count taps on a back button.
    if (attempt.is_new) {
      await signals.record(client, {
        userId: actor.userId,
        kind: 'quiz_started',
        topicId: quiz.topic_id,
        refKind: 'quiz',
        refId: quiz.quiz_id,
        metadata: { attemptId: attempt.id },
      });
    }

    const [questions, progress] = await Promise.all([
      repo.listSessionQuestions(
        { quizId: quiz.quiz_id, topicId: quiz.topic_id, attemptId: attempt.id },
        client,
      ),
      repo.findTopicProgress({ userId: actor.userId, topicId: quiz.topic_id }, client),
    ]);

    return {
      attemptId: attempt.id,
      quizId: quiz.quiz_id,
      quizTitle: quiz.quiz_title,
      topicId: quiz.topic_id,
      topicName: localised(quiz.topic_name_ar, quiz.topic_name_en, locale),
      questions: questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        difficulty: q.difficulty,
        points: q.points,
        options: q.options,
        answered: q.answered,
      })),
      progress: projectProgress(quiz.topic_id, progress),
    };
  });
}

/**
 * Answers one question.
 *
 * The whole loop runs inside a single transaction, and the ordering is the
 * point:
 *
 *   lock the attempt  →  read the key  →  grade in @sos/core
 *   →  write the observation (once)     →  roll it into learning_progress
 *   →  recompute weakness and store it  →  record the learning event
 *   →  close the attempt if it is finished
 *
 * If anything after the lock throws, the whole thing rolls back and the
 * student's progress is exactly what it was. That is not a nicety: a
 * `learning_progress` row that moved without an answer behind it is
 * indistinguishable from a real one and nothing downstream can ever correct it.
 *
 * The lock is `FOR UPDATE` on the attempt, which serialises two submissions of
 * the same answer. The second finds the row already inserted, writes nothing,
 * and returns the stored verdict.
 */
export async function submitAnswer(
  actor: Actor,
  attemptId: string,
  body: SubmitPracticeAnswerRequest,
): Promise<PracticeAnswerResult> {
  return withTransaction(async (client) => {
    /*
     * Ownership is in the WHERE clause. Another student's attempt id does not
     * come back, so this is a 404 and not a 403 — the same 404-not-403 rule the
     * rest of the API follows, and the reason a probe cannot confirm that an
     * attempt exists. Submitted attempts ARE found — see the retry path below.
     */
    const attempt = await repo.lockAttempt({ attemptId, userId: actor.userId }, client);
    if (!attempt) throw errors.notFound('practice attempt');

    /*
     * The question is resolved inside the attempt's quiz AND the attempt's
     * topic. The topic scope is the boundary invariant: a quiz may hold
     * questions from several topics, and without it a valid question id from
     * Topic B, submitted through an attempt started for Topic A, would grade
     * and roll into B's progress. Outside the boundary the question is simply
     * not found — never refused — so the probe learns nothing.
     */
    const question = await repo.findGradableQuestion(
      { quizId: attempt.quiz_id, topicId: attempt.topic_id, questionId: body.questionId },
      client,
    );
    if (!question) throw errors.notFound('question');

    /*
     * A submitted attempt answers retries and accepts nothing new.
     *
     * The final answer of a set writes the answer AND closes the attempt in one
     * transaction. When that response is lost on the wire, the client retries a
     * request that already succeeded — and the retry arrives at a submitted
     * attempt. The stored verdict is returned, identical to the response that
     * was lost, and nothing moves.
     *
     * A question this attempt never answered — one added to the quiz after
     * submission, say — is a 404: the attempt is closed, and for new writes a
     * closed attempt is indistinguishable from an absent one.
     */
    if (attempt.status === 'submitted') {
      const stored = await repo.findStoredAnswer({ attemptId, questionId: question.id }, client);
      if (!stored) throw errors.notFound('practice attempt');
      return storedResult({ question, stored, attemptCompleted: true }, actor, client);
    }

    const grade = gradeSelection(
      {
        kind: question.kind,
        correctOptionIds: question.correct_option_ids,
        points: question.points,
      },
      body.selectedOptionIds,
    );

    const inserted = await repo.insertAnswerOnce(
      {
        attemptId,
        questionId: question.id,
        selectedOptionIds: body.selectedOptionIds,
        isCorrect: grade.isCorrect,
        pointsAwarded: grade.pointsAwarded,
      },
      client,
    );

    /*
     * A resubmission. Nothing was written, so nothing may move — not the
     * counters, not the weakness, not the event log. The stored verdict is
     * returned rather than the freshly computed one, because the stored one is
     * what the student's progress was actually built from.
     */
    if (!inserted) {
      const stored = await repo.findStoredAnswer({ attemptId, questionId: question.id }, client);
      return storedResult(
        { question, stored, attemptCompleted: false },
        actor,
        client,
      );
    }

    /*
     * An untagged question is still a real observation — the answer row above
     * is written either way — but it cannot roll up, because progress is
     * per-topic and there is no topic. Recording it against a placeholder would
     * be worse than recording nothing.
     */
    let progress: TopicProgress | null = null;

    if (question.topic_id) {
      const row = await signals.touchTopicProgress(client, {
        userId: actor.userId,
        topicId: question.topic_id,
        seen: 1,
        correct: grade.isCorrect ? 1 : 0,
      });

      // The formula lives in @sos/core. This writes back what it returns; there
      // is no arithmetic here and none in the SQL.
      const signal = computeWeakness({
        topicId: question.topic_id,
        questionsSeen: row.questions_seen,
        questionsCorrect: row.questions_correct,
        lastActivityAt: row.last_activity_at,
      });
      await signals.storeWeakness(client, {
        userId: actor.userId,
        topicId: question.topic_id,
        weaknessScore: signal.weaknessScore,
        confidence: signal.confidence,
      });

      progress = projectProgress(question.topic_id, row);
    }

    await signals.record(client, {
      userId: actor.userId,
      kind: 'practice_question_answered',
      topicId: question.topic_id,
      refKind: 'quiz_question',
      refId: question.id,
      value: grade.pointsAwarded,
      metadata: { attemptId, isCorrect: grade.isCorrect },
    });

    const attemptCompleted = question.topic_id
      ? await closeAttemptIfFinished(client, {
          actor,
          attemptId,
          quizId: attempt.quiz_id,
          topicId: question.topic_id,
        })
      : false;

    return {
      questionId: question.id,
      isCorrect: grade.isCorrect,
      correctOptionIds: question.correct_option_ids,
      explanation: question.explanation,
      pointsAwarded: grade.pointsAwarded,
      alreadyAnswered: false,
      attemptCompleted,
      progress,
    };
  });
}

/**
 * The stored verdict, projected the same way whichever path re-asked for it.
 *
 * Used for both idempotent returns — the same question resubmitted while the
 * attempt is open, and any retry arriving after the attempt closed. The result
 * reproduces the response the first submission produced (with `alreadyAnswered`
 * flagged), so a client that lost the original learns exactly what it missed.
 */
async function storedResult(
  input: {
    question: { id: string; topic_id: string | null; explanation: string | null; correct_option_ids: string[] };
    stored: { is_correct: boolean; points_awarded: string } | null;
    attemptCompleted: boolean;
  },
  actor: Actor,
  client: Sql,
): Promise<PracticeAnswerResult> {
  const topicId = input.question.topic_id;
  const current = topicId
    ? await repo.findTopicProgress({ userId: actor.userId, topicId }, client)
    : null;
  return {
    questionId: input.question.id,
    isCorrect: input.stored?.is_correct ?? false,
    correctOptionIds: input.question.correct_option_ids,
    explanation: input.question.explanation,
    pointsAwarded: Number(input.stored?.points_awarded ?? 0),
    alreadyAnswered: true,
    attemptCompleted: input.attemptCompleted,
    progress: topicId ? projectProgress(topicId, current) : null,
  };
}

/**
 * Closes the attempt once every question in it has been answered.
 *
 * There is no "submit" button and no route for one. An attempt that is finished
 * is finished, and asking the student to confirm it invites the state where
 * they answered everything, left, and the attempt stays open forever — which
 * would then block the next session on the unique in-progress index.
 *
 * `quiz_completed` is the meaningful event here (0005 seeds it `true`), and it
 * is emitted exactly once because `submitAttempt` only matches rows still
 * `in_progress`.
 */
async function closeAttemptIfFinished(
  client: Sql,
  input: { actor: Actor; attemptId: string; quizId: string; topicId: string },
): Promise<boolean> {
  const { answered, total } = await repo.attemptCompletion(
    { attemptId: input.attemptId, quizId: input.quizId, topicId: input.topicId },
    client,
  );
  if (total === 0 || answered < total) return false;

  await repo.submitAttempt(input.attemptId, client);
  await signals.record(client, {
    userId: input.actor.userId,
    kind: 'quiz_completed',
    topicId: input.topicId,
    refKind: 'quiz',
    refId: input.quizId,
    value: answered,
    metadata: { attemptId: input.attemptId },
  });
  return true;
}
