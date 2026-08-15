import { randomUUID } from 'node:crypto';
import type {
  LearnOverview,
  PracticeAnswerResult,
  PracticeSession,
  TopicDetail,
} from '@sos/contracts';
import { computeWeakness } from '@sos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query, queryOne, queryRows } from '../src/platform/db.js';
import {
  auth,
  closeApp,
  ensureCohort,
  getApp,
  onboardedUser,
  readProgressRow,
  seedPracticeQuiz,
  type Cohort,
} from './helpers.js';

/**
 * Phase 5d — the learning loop, closed.
 *
 * The claim under test is one sentence: **a student answering a question
 * changes what the system knows about them, and the surfaces that read that
 * knowledge change with it.**
 *
 * Before this phase `learning_progress` had three readers and no reachable
 * writer. Every assertion here that reads a number out of the Learn tab, the
 * topic page or the feed is therefore also a regression test against that
 * returning: if the writer is ever disconnected again, these fail rather than
 * quietly reporting zero.
 */

let cohort: Cohort;
type Session = Awaited<ReturnType<typeof onboardedUser>>;

beforeAll(async () => {
  await getApp();
  cohort = await ensureCohort();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

async function startPractice(session: Session, topicId: string): Promise<PracticeSession> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/topics/${topicId}/practice`,
    headers: auth(session.session),
  });
  if (response.statusCode !== 200) {
    throw new Error(`practice start failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<PracticeSession>();
}

async function answer(
  session: Session,
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
): Promise<{ statusCode: number; body: PracticeAnswerResult }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/practice/attempts/${attemptId}/answers`,
    headers: auth(session.session),
    payload: { questionId, selectedOptionIds },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** The option the author marked correct, read straight from the key. */
async function correctOptionIds(questionId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM quiz_options WHERE question_id = $1 AND is_correct ORDER BY ordinal`,
    [questionId],
  );
  return rows.map((r) => r.id);
}

async function wrongOptionIds(questionId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM quiz_options WHERE question_id = $1 AND NOT is_correct ORDER BY ordinal LIMIT 1`,
    [questionId],
  );
  return rows.map((r) => r.id);
}

/**
 * A topic of this test's own.
 *
 * The suite shares one database, and practice picks the quiz with the most
 * questions on a topic — so two tests seeding different quizzes against the
 * same topic would hand the second one the first one's questions. A fresh topic
 * per test makes each session contain exactly what that test created, which is
 * also what makes the assertions readable.
 */
async function freshTopic(label: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO topics (subject_id, slug, name_ar, name_en, ordinal)
     SELECT s.id, $1, $2, $3, 50
     FROM subjects s WHERE s.course_id = $4 ORDER BY s.slug LIMIT 1
     RETURNING id`,
    [`practice-${randomUUID()}`, label, label, cohort.courseIds[0]],
  );
  return row!.id;
}

/** One two-option question on a topic, and a student enrolled where it lives. */
async function oneQuestionOn(topicId: string, prompt = 'سؤال تدريبي'): Promise<string> {
  const { questionIds } = await seedPracticeQuiz({
    courseId: cohort.courseIds[0]!,
    questions: [
      {
        topicId,
        prompt,
        explanation: 'التفسير.',
        options: [
          { label: 'الإجابة الصحيحة', correct: true },
          { label: 'إجابة خاطئة', correct: false },
        ],
      },
    ],
  });
  return questionIds[0]!;
}

// --- the observation --------------------------------------------------------

describe('an answer is an observation, and it is graded on the server', () => {
  it('never sends the key to the client before it answers', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    await oneQuestionOn(topicId, 'ما هي السمة المميزة للمتلازمة الكلوية؟');
    const student = await onboardedUser();

    const session = await startPractice(student, topicId);
    const raw = JSON.stringify(session);

    expect(session.questions.length).toBeGreaterThan(0);
    expect(raw).not.toContain('isCorrect');
    expect(raw).not.toContain('is_correct');
    expect(raw).not.toContain('correctOptionIds');
    // The options are there; which of them is right is not.
    expect(session.questions[0]!.options.length).toBe(2);
  });

  it('a correct answer moves seen and correct together', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);

    const before = await readProgressRow(student.session.user.id, topicId);
    expect(before).toBeNull();

    const result = await answer(
      student,
      session.attemptId,
      questionId,
      await correctOptionIds(questionId),
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.isCorrect).toBe(true);
    expect(result.body.alreadyAnswered).toBe(false);

    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 1 });
  });

  it('an incorrect answer moves seen only, and leaves correct where it was', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);

    const result = await answer(
      student,
      session.attemptId,
      questionId,
      await wrongOptionIds(questionId),
    );

    expect(result.body.isCorrect).toBe(false);
    // The explanation and the key arrive only now, with the verdict.
    expect(result.body.correctOptionIds).toEqual(await correctOptionIds(questionId));

    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 0 });
  });

  it('a client-declared verdict is ignored — the server grades from the key', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const app = await getApp();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/practice/attempts/${session.attemptId}/answers`,
      headers: auth(student.session),
      // Every shape a client might use to assert its own correctness.
      payload: {
        questionId,
        selectedOptionIds: await wrongOptionIds(questionId),
        isCorrect: true,
        pointsAwarded: 99,
        progress: { questionsSeen: 100, questionsCorrect: 100 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<PracticeAnswerResult>().isCorrect).toBe(false);
    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 0 });
  });
});

// --- idempotency and isolation ---------------------------------------------

describe('a progress mutation happens exactly once, for exactly one student', () => {
  /**
   * Two questions, not one.
   *
   * A single-question set closes its attempt on the first answer, and a
   * resubmission then meets a submitted attempt rather than the duplicate guard.
   * That path has its own test below; this one is about the guard itself, so the
   * attempt has to still be open.
   */
  async function twoQuestionsOn(topicId: string): Promise<string[]> {
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Idempotency set',
      questions: [0, 1].map((n) => ({
        topicId,
        prompt: `سؤال ${n}`,
        options: [
          { label: 'صحيح', correct: true },
          { label: 'خاطئ', correct: false },
        ],
      })),
    });
    return questionIds;
  }

  it('answering the same question twice does not count it twice', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = (await twoQuestionsOn(topicId))[0]!;
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const key = await correctOptionIds(questionId);

    const first = await answer(student, session.attemptId, questionId, key);
    const second = await answer(student, session.attemptId, questionId, key);

    expect(first.body.alreadyAnswered).toBe(false);
    expect(second.body.alreadyAnswered).toBe(true);
    // The stored verdict comes back, not a fresh grade of the resubmission.
    expect(second.body.isCorrect).toBe(true);

    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 1 });

    const answers = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE attempt_id = $1`,
      [session.attemptId],
    );
    expect(answers!.n).toBe(1);
  });

  it('changing the selection on a resubmission cannot rewrite the record', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = (await twoQuestionsOn(topicId))[0]!;
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);

    await answer(student, session.attemptId, questionId, await wrongOptionIds(questionId));
    const retry = await answer(
      student,
      session.attemptId,
      questionId,
      await correctOptionIds(questionId),
    );

    expect(retry.body.alreadyAnswered).toBe(true);
    expect(retry.body.isCorrect).toBe(false);
    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 0 });
  });

  it('a finished attempt counts nothing further', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const key = await correctOptionIds(questionId);

    const first = await answer(student, session.attemptId, questionId, key);
    expect(first.body.attemptCompleted).toBe(true);

    /*
     * A repeat of the final submission is ANSWERED — with the stored verdict —
     * because a lost HTTP response makes the client retry a request that
     * already succeeded, and 404ing it would tell a student their real answer
     * vanished. What a finished attempt never does is move a counter. The
     * closed-for-new-writes half of the invariant has its own test in the
     * retry describe block.
     */
    const late = await answer(student, session.attemptId, questionId, key);
    expect(late.statusCode).toBe(200);
    expect(late.body.alreadyAnswered).toBe(true);

    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({ questions_seen: 1, questions_correct: 1 });
  });

  it('two topics accumulate separately', async () => {
    const topicA = await freshTopic('موضوع تدريبي');
    const topicB = await freshTopic('موضوع تدريبي');
    const questionA = await oneQuestionOn(topicA);
    const questionB = await oneQuestionOn(topicB);
    const student = await onboardedUser();

    const sessionA = await startPractice(student, topicA);
    await answer(student, sessionA.attemptId, questionA, await correctOptionIds(questionA));

    const sessionB = await startPractice(student, topicB);
    await answer(student, sessionB.attemptId, questionB, await wrongOptionIds(questionB));

    expect(await readProgressRow(student.session.user.id, topicA)).toMatchObject({
      questions_seen: 1,
      questions_correct: 1,
    });
    expect(await readProgressRow(student.session.user.id, topicB)).toMatchObject({
      questions_seen: 1,
      questions_correct: 0,
    });
  });

  it('two students accumulate separately', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const [alice, bilal] = await Promise.all([onboardedUser(), onboardedUser()]);

    const aliceSession = await startPractice(alice, topicId);
    await answer(alice, aliceSession.attemptId, questionId, await correctOptionIds(questionId));

    const bilalSession = await startPractice(bilal, topicId);
    await answer(bilal, bilalSession.attemptId, questionId, await wrongOptionIds(questionId));

    expect(await readProgressRow(alice.session.user.id, topicId)).toMatchObject({
      questions_seen: 1,
      questions_correct: 1,
    });
    expect(await readProgressRow(bilal.session.user.id, topicId)).toMatchObject({
      questions_seen: 1,
      questions_correct: 0,
    });
  });

  it('a student cannot write into another student’s attempt, and is not told it exists', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const [owner, intruder] = await Promise.all([onboardedUser(), onboardedUser()]);
    const session = await startPractice(owner, topicId);

    const attack = await answer(
      intruder,
      session.attemptId,
      questionId,
      await correctOptionIds(questionId),
    );

    // 404, not 403: a 403 would confirm that this attempt id is real.
    expect(attack.statusCode).toBe(404);
    expect(await readProgressRow(intruder.session.user.id, topicId)).toBeNull();
    expect(await readProgressRow(owner.session.user.id, topicId)).toBeNull();
    const answers = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE attempt_id = $1`,
      [session.attemptId],
    );
    expect(answers!.n).toBe(0);
  });

  it('a second start resumes the same attempt rather than opening another', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    await oneQuestionOn(topicId);
    const student = await onboardedUser();

    const first = await startPractice(student, topicId);
    const second = await startPractice(student, topicId);

    expect(second.attemptId).toBe(first.attemptId);
    const attempts = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2`,
      [student.session.user.id, first.quizId],
    );
    expect(attempts!.n).toBe(1);
  });

  it('offers no practice where the student has none, rather than an empty session', async () => {
    const student = await onboardedUser();
    const app = await getApp();
    // A topic that exists, with no quiz published against it for this student.
    const orphan = await queryOne<{ id: string }>(
      `INSERT INTO topics (subject_id, slug, name_ar, name_en, ordinal)
       SELECT s.id, 'no-practice-topic', 'بدون تدريب', 'No Practice', 99 FROM subjects s LIMIT 1
       ON CONFLICT (subject_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/topics/${orphan!.id}/practice`,
      headers: auth(student.session),
    });
    expect(response.statusCode).toBe(404);
  });
});

// --- the topic boundary -----------------------------------------------------

describe('an attempt is bound to the topic it was started for', () => {
  /** One quiz whose questions span two topics — the adversarial shape. */
  async function mixedQuiz(topicA: string, topicB: string): Promise<{
    aQuestion: string;
    bQuestion: string;
  }> {
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Mixed-topic quiz',
      questions: [
        {
          topicId: topicA,
          prompt: 'سؤال الموضوع أ',
          options: [
            { label: 'صحيح', correct: true },
            { label: 'خاطئ', correct: false },
          ],
        },
        {
          topicId: topicB,
          prompt: 'سؤال الموضوع ب',
          options: [
            { label: 'صحيح', correct: true },
            { label: 'خاطئ', correct: false },
          ],
        },
      ],
    });
    return { aQuestion: questionIds[0]!, bQuestion: questionIds[1]! };
  }

  it('rejects a valid question from another topic of the same quiz', async () => {
    const topicA = await freshTopic('موضوع أ');
    const topicB = await freshTopic('موضوع ب');
    const { bQuestion } = await mixedQuiz(topicA, topicB);
    const student = await onboardedUser();

    const session = await startPractice(student, topicA);
    // The session itself never offered the Topic B question.
    expect(session.questions.some((q) => q.id === bQuestion)).toBe(false);

    // Submit it anyway — a real question id, in this attempt's own quiz.
    const attack = await answer(
      student,
      session.attemptId,
      bQuestion,
      await correctOptionIds(bQuestion),
    );

    // Not found, not refused: the probe must not learn the id was real.
    expect(attack.statusCode).toBe(404);
  });

  it('leaves the other topic’s progress untouched by the rejected submission', async () => {
    const topicA = await freshTopic('موضوع أ');
    const topicB = await freshTopic('موضوع ب');
    const { bQuestion } = await mixedQuiz(topicA, topicB);
    const student = await onboardedUser();

    const session = await startPractice(student, topicA);
    await answer(student, session.attemptId, bQuestion, await correctOptionIds(bQuestion));

    expect(await readProgressRow(student.session.user.id, topicB)).toBeNull();
    expect(await readProgressRow(student.session.user.id, topicA)).toBeNull();
    const answers = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE attempt_id = $1`,
      [session.attemptId],
    );
    expect(answers!.n).toBe(0);
  });

  it('cannot be completed by answering another topic’s questions', async () => {
    const topicA = await freshTopic('موضوع أ');
    const topicB = await freshTopic('موضوع ب');
    const { aQuestion, bQuestion } = await mixedQuiz(topicA, topicB);
    const student = await onboardedUser();

    const session = await startPractice(student, topicA);
    // The Topic B question bounces; the attempt must still be open and waiting
    // for its own single question.
    await answer(student, session.attemptId, bQuestion, await correctOptionIds(bQuestion));

    const open = await queryOne<{ status: string }>(
      `SELECT status::text AS status FROM quiz_attempts WHERE id = $1`,
      [session.attemptId],
    );
    expect(open!.status).toBe('in_progress');

    // Its own question closes it — one question on Topic A is the whole set.
    const own = await answer(
      student,
      session.attemptId,
      aQuestion,
      await correctOptionIds(aQuestion),
    );
    expect(own.body.attemptCompleted).toBe(true);
  });

  it('starting the other topic on the same quiz opens a NEW attempt, not the old one', async () => {
    const topicA = await freshTopic('موضوع أ');
    const topicB = await freshTopic('موضوع ب');
    const { aQuestion, bQuestion } = await mixedQuiz(topicA, topicB);
    const student = await onboardedUser();

    const sessionA = await startPractice(student, topicA);
    const sessionB = await startPractice(student, topicB);

    // Same quiz, different topic ⇒ a different attempt. Resuming the Topic A
    // attempt for Topic B would let one attempt mutate two topics' progress.
    expect(sessionB.quizId).toBe(sessionA.quizId);
    expect(sessionB.attemptId).not.toBe(sessionA.attemptId);

    // The Topic A attempt was closed, its answers already rolled up; only the
    // Topic B attempt is live.
    const statuses = await queryRows<{ id: string; status: string }>(
      `SELECT id, status::text AS status FROM quiz_attempts WHERE user_id = $1 ORDER BY started_at`,
      [student.session.user.id],
    );
    expect(statuses.find((row) => row.id === sessionA.attemptId)!.status).toBe('abandoned');
    expect(statuses.find((row) => row.id === sessionB.attemptId)!.status).toBe('in_progress');

    // And each attempt answers only its own topic.
    const aViaB = await answer(
      student,
      sessionB.attemptId,
      aQuestion,
      await correctOptionIds(aQuestion),
    );
    expect(aViaB.statusCode).toBe(404);
    const bViaB = await answer(
      student,
      sessionB.attemptId,
      bQuestion,
      await correctOptionIds(bQuestion),
    );
    expect(bViaB.statusCode).toBe(200);
    expect(await readProgressRow(student.session.user.id, topicB)).toMatchObject({
      questions_seen: 1,
      questions_correct: 1,
    });
    expect(await readProgressRow(student.session.user.id, topicA)).toBeNull();
  });
});

// --- the retry after the attempt closed -------------------------------------

describe('a retry after the attempt closed is answered, not 404d', () => {
  it('returns the stored verdict for a lost final-answer response, and moves nothing', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const key = await correctOptionIds(questionId);

    // The final answer: writes the observation AND closes the attempt.
    const original = await answer(student, session.attemptId, questionId, key);
    expect(original.body.attemptCompleted).toBe(true);

    const closed = await queryOne<{ status: string }>(
      `SELECT status::text AS status FROM quiz_attempts WHERE id = $1`,
      [session.attemptId],
    );
    expect(closed!.status).toBe('submitted');

    // The response is lost; the client retries the identical request.
    const retry = await answer(student, session.attemptId, questionId, key);

    // Answered with what the original response said — not a 404 for a request
    // that already succeeded.
    expect(retry.statusCode).toBe(200);
    expect(retry.body.isCorrect).toBe(original.body.isCorrect);
    expect(retry.body.attemptCompleted).toBe(true);
    expect(retry.body.alreadyAnswered).toBe(true);
    expect(retry.body.progress).toMatchObject({
      questionsSeen: original.body.progress!.questionsSeen,
      questionsCorrect: original.body.progress!.questionsCorrect,
    });

    // And nothing moved: one answer row, one event, the same counters.
    const answers = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE attempt_id = $1`,
      [session.attemptId],
    );
    expect(answers!.n).toBe(1);
    const events = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM learning_events
       WHERE user_id = $1 AND kind = 'practice_question_answered' AND subject_ref_id = $2`,
      [student.session.user.id, questionId],
    );
    expect(events!.n).toBe(1);
    expect(await readProgressRow(student.session.user.id, topicId)).toMatchObject({
      questions_seen: 1,
      questions_correct: 1,
    });
  });

  it('a submitted attempt refuses a question it never answered', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    await answer(student, session.attemptId, questionId, await correctOptionIds(questionId));

    // A question added to the same quiz and topic AFTER the attempt closed.
    const late = await queryOne<{ id: string }>(
      `INSERT INTO quiz_questions (quiz_id, topic_id, kind, prompt, points, ordinal)
       VALUES ($1, $2, 'mcq_single', 'سؤال متأخر', 1, 9)
       RETURNING id`,
      [session.quizId, topicId],
    );
    await queryOne(
      `INSERT INTO quiz_options (question_id, label, is_correct, ordinal)
       VALUES ($1, 'صحيح', true, 0) RETURNING id`,
      [late!.id],
    );

    const attempt = await answer(student, session.attemptId, late!.id, await correctOptionIds(late!.id));

    // Closed for new writes — indistinguishable from absent.
    expect(attempt.statusCode).toBe(404);
    expect(await readProgressRow(student.session.user.id, topicId)).toMatchObject({
      questions_seen: 1,
      questions_correct: 1,
    });
  });

  it('another student cannot read a submitted attempt’s verdict either', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const [owner, intruder] = await Promise.all([onboardedUser(), onboardedUser()]);
    const session = await startPractice(owner, topicId);
    const key = await correctOptionIds(questionId);
    await answer(owner, session.attemptId, questionId, key);

    // The retry path must not have widened ownership: the stored verdict is
    // the owner's to re-read and nobody else's.
    const probe = await answer(intruder, session.attemptId, questionId, key);
    expect(probe.statusCode).toBe(404);
  });
});

// --- the transactional boundary --------------------------------------------

describe('progress moves only with the observation that caused it', () => {
  /**
   * A failure injected after the progress write, at the learning-event insert.
   *
   * A trigger rather than a mock: the point is that the DATABASE rolls the whole
   * thing back, and a mocked repository would prove only that the mock threw.
   * `learning_events` is the last write in the transaction, so if progress
   * survives a failure it will survive it here.
   */
  it('a failure anywhere in the submission leaves progress exactly as it was', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const first = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);

    // One good answer, so there is a non-zero baseline to preserve.
    await answer(student, session.attemptId, first, await correctOptionIds(first));
    const baseline = await readProgressRow(student.session.user.id, topicId);
    expect(baseline).toMatchObject({ questions_seen: 1, questions_correct: 1 });

    const second = await oneQuestionOn(topicId, 'سؤال ثانٍ');
    const secondSession = await startPractice(student, topicId);

    await query(`
      CREATE OR REPLACE FUNCTION practice_test_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'practice_question_answered' THEN
          RAISE EXCEPTION 'injected failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await query(`
      CREATE TRIGGER practice_test_fail_trigger
      BEFORE INSERT ON learning_events
      FOR EACH ROW EXECUTE FUNCTION practice_test_fail();
    `);

    try {
      const failed = await answer(
        student,
        secondSession.attemptId,
        second,
        await correctOptionIds(second),
      );
      expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await query(`DROP TRIGGER IF EXISTS practice_test_fail_trigger ON learning_events`);
      await query(`DROP FUNCTION IF EXISTS practice_test_fail()`);
    }

    const after = await readProgressRow(student.session.user.id, topicId);
    expect(after).toMatchObject({
      questions_seen: baseline!.questions_seen,
      questions_correct: baseline!.questions_correct,
    });
    const orphaned = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE question_id = $1`,
      [second],
    );
    expect(orphaned!.n).toBe(0);
  });

  it('writes an answer row, a learning event and a progress row from one submission', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);

    await answer(student, session.attemptId, questionId, await correctOptionIds(questionId));

    const answerRow = await queryOne<{ is_correct: boolean }>(
      `SELECT is_correct FROM quiz_answers WHERE attempt_id = $1 AND question_id = $2`,
      [session.attemptId, questionId],
    );
    expect(answerRow!.is_correct).toBe(true);

    const events = await queryRows<{ kind: string; topic_id: string | null }>(
      `SELECT kind, topic_id FROM learning_events
       WHERE user_id = $1 AND subject_ref_id = $2`,
      [student.session.user.id, questionId],
    );
    expect(events.map((e) => e.kind)).toContain('practice_question_answered');
    expect(events[0]!.topic_id).toBe(topicId);

    expect(await readProgressRow(student.session.user.id, topicId)).not.toBeNull();
  });

  it('closes the attempt and records the meaningful event once the set is finished', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Two question set',
      questions: [0, 1].map((n) => ({
        topicId,
        prompt: `سؤال ${n}`,
        options: [
          { label: 'صحيح', correct: true },
          { label: 'خاطئ', correct: false },
        ],
      })),
    });
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    // The session may include questions from an earlier seeded quiz; drive the
    // one this test created by answering exactly its questions.
    const mine = session.questions.filter((q) => questionIds.includes(q.id));
    expect(mine.length).toBe(2);

    const first = await answer(
      student,
      session.attemptId,
      mine[0]!.id,
      await correctOptionIds(mine[0]!.id),
    );
    expect(first.body.attemptCompleted).toBe(false);

    const last = await answer(
      student,
      session.attemptId,
      mine[1]!.id,
      await correctOptionIds(mine[1]!.id),
    );
    expect(last.body.attemptCompleted).toBe(true);

    const attempt = await queryOne<{ status: string; score: string; max_score: string }>(
      `SELECT status::text AS status, score::text AS score, max_score::text AS max_score
       FROM quiz_attempts WHERE id = $1`,
      [session.attemptId],
    );
    expect(attempt!.status).toBe('submitted');
    expect(Number(attempt!.score)).toBe(2);
    expect(Number(attempt!.max_score)).toBe(2);

    const completed = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM learning_events
       WHERE user_id = $1 AND kind = 'quiz_completed' AND metadata->>'attemptId' = $2`,
      [student.session.user.id, session.attemptId],
    );
    expect(completed!.n).toBe(1);
  });
});

// --- the weakness signal ----------------------------------------------------

describe('weakness is computed by the existing estimator, and only by it', () => {
  it('rises with wrong answers and matches @sos/core exactly', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Weakness set',
      questions: [0, 1, 2].map((n) => ({
        topicId,
        prompt: `سؤال ضعف ${n}`,
        options: [
          { label: 'صحيح', correct: true },
          { label: 'خاطئ', correct: false },
        ],
      })),
    });
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const mine = session.questions.filter((q) => questionIds.includes(q.id));

    let last: PracticeAnswerResult | null = null;
    for (const question of mine) {
      const outcome = await answer(
        student,
        session.attemptId,
        question.id,
        await wrongOptionIds(question.id),
      );
      last = outcome.body;
    }

    const row = await readProgressRow(student.session.user.id, topicId);
    expect(row).toMatchObject({ questions_seen: 3, questions_correct: 0 });

    // The stored number is the estimator's, not a second implementation's.
    const expected = computeWeakness({
      topicId,
      questionsSeen: row!.questions_seen,
      questionsCorrect: row!.questions_correct,
      lastActivityAt: row!.last_activity_at,
    });
    expect(row!.weakness_score).toBeCloseTo(expected.weaknessScore, 5);
    expect(row!.confidence).toBeCloseTo(expected.confidence, 5);
    // All wrong and answered just now: 0.7 · inaccuracy dominates.
    expect(row!.weakness_score!).toBeGreaterThan(0.65);
    expect(last!.progress!.weaknessScore).toBeCloseTo(expected.weaknessScore, 5);
  });

  it('confidence grows with the size of the sample, and says so while it is small', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Confidence set',
      questions: Array.from({ length: 6 }, (_, n) => ({
        topicId,
        prompt: `سؤال ثقة ${n}`,
        options: [
          { label: 'صحيح', correct: true },
          { label: 'خاطئ', correct: false },
        ],
      })),
    });
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    const mine = session.questions.filter((q) => questionIds.includes(q.id));

    const confidences: number[] = [];
    const lowFlags: boolean[] = [];
    for (const question of mine) {
      const outcome = await answer(
        student,
        session.attemptId,
        question.id,
        await correctOptionIds(question.id),
      );
      confidences.push(outcome.body.progress!.confidence);
      lowFlags.push(outcome.body.progress!.lowConfidence);
    }

    // Strictly increasing: every additional observation is more evidence.
    for (let i = 1; i < confidences.length; i += 1) {
      expect(confidences[i]!).toBeGreaterThan(confidences[i - 1]!);
    }
    // Below MIN_QUESTIONS_FOR_CONFIDENCE the API says the sample is too small.
    expect(lowFlags[0]).toBe(true);
    expect(lowFlags[lowFlags.length - 1]).toBe(false);
  });

  it('stale evidence weakens a topic even when every answer was right', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId, 'سؤال قديم');
    const student = await onboardedUser();
    const session = await startPractice(student, topicId);
    await answer(student, session.attemptId, questionId, await correctOptionIds(questionId));

    const fresh = await readProgressRow(student.session.user.id, topicId);
    expect(fresh!.questions_correct).toBe(1);

    /*
     * The staleness term is a function of `last_activity_at`, and there is no
     * way to wait 28 days in a test. Ageing the row and re-running the ESTIMATOR
     * — not a reimplementation of it — is what proves the recency half-life is
     * actually in the path: a perfect score six weeks old is not the same signal
     * as a perfect score today.
     */
    const staleAt = new Date(Date.now() - 28 * 86_400_000);
    const now = new Date();
    const freshSignal = computeWeakness(
      {
        topicId,
        questionsSeen: fresh!.questions_seen,
        questionsCorrect: fresh!.questions_correct,
        lastActivityAt: fresh!.last_activity_at,
      },
      now,
    );
    const staleSignal = computeWeakness(
      {
        topicId,
        questionsSeen: fresh!.questions_seen,
        questionsCorrect: fresh!.questions_correct,
        lastActivityAt: staleAt,
      },
      now,
    );

    expect(freshSignal.weaknessScore).toBeCloseTo(0, 3);
    // Two half-lives at 14 days ⇒ staleness ≈ 0.75, weighted 0.3.
    expect(staleSignal.weaknessScore).toBeGreaterThan(0.2);
    expect(staleSignal.weaknessScore).toBeGreaterThan(freshSignal.weaknessScore);
  });
});

// --- the surfaces that read it ---------------------------------------------

describe('the surfaces that read the signal now show it', () => {
  it('the topic page reports the student’s own counts and offers practice', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const app = await getApp();

    const before = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}`,
      headers: auth(student.session),
    });
    const beforeBody = before.json<TopicDetail>();
    expect(beforeBody.viewer.canPractice).toBe(true);
    expect(beforeBody.viewer.questionsSeen).toBe(0);

    const session = await startPractice(student, topicId);
    await answer(student, session.attemptId, questionId, await correctOptionIds(questionId));

    const after = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}`,
      headers: auth(student.session),
    });
    const afterBody = after.json<TopicDetail>();
    expect(afterBody.viewer.questionsSeen).toBe(1);
    expect(afterBody.viewer.questionsCorrect).toBe(1);
    expect(afterBody.viewer.lastActivityAt).not.toBeNull();
  });

  it('the Learn tab’s focus topics fill up, and carry the low-confidence flag', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const questionId = await oneQuestionOn(topicId);
    const student = await onboardedUser();
    const app = await getApp();

    const empty = await app.inject({
      method: 'GET',
      url: '/v1/learn',
      headers: auth(student.session),
    });
    expect(empty.json<LearnOverview>().focusTopics).toHaveLength(0);

    const session = await startPractice(student, topicId);
    await answer(student, session.attemptId, questionId, await wrongOptionIds(questionId));

    const filled = await app.inject({
      method: 'GET',
      url: '/v1/learn',
      headers: auth(student.session),
    });
    const overview = filled.json<LearnOverview>();
    const focus = overview.focusTopics.find((topic) => topic.id === topicId);

    expect(focus).toBeDefined();
    expect(focus!.questionsSeen).toBe(1);
    expect(focus!.weaknessScore!).toBeGreaterThan(0.65);
    // One answer is not a finding about a student, and the API says so.
    expect(focus!.lowConfidence).toBe(true);
  });

  it('the feed’s weak-topic term fires — it never could before', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const { questionIds } = await seedPracticeQuiz({
      courseId: cohort.courseIds[0]!,
      title: 'Feed weight set',
      questions: [0, 1].map((n) => ({
        topicId,
        prompt: `سؤال تغذية ${n}`,
        options: [
          { label: 'صحيح', correct: true },
          { label: 'خاطئ', correct: false },
        ],
      })),
    });
    const student = await onboardedUser();

    /*
     * `matches_weak_topic` is `weakness_score >= 0.5` on a topic the content is
     * tagged with, and it is worth 2.5 — the second-heaviest term in the feed's
     * scoring. Asserting the predicate against the same SQL the ranker runs is
     * what proves the term is reachable rather than that the column moved.
     */
    const beforeMatch = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM learning_progress lp
         WHERE lp.user_id = $1 AND lp.topic_id = $2 AND lp.weakness_score >= 0.5
       ) AS ok`,
      [student.session.user.id, topicId],
    );
    expect(beforeMatch!.ok).toBe(false);

    const session = await startPractice(student, topicId);
    for (const question of session.questions.filter((q) => questionIds.includes(q.id))) {
      await answer(student, session.attemptId, question.id, await wrongOptionIds(question.id));
    }

    const afterMatch = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM learning_progress lp
         WHERE lp.user_id = $1 AND lp.topic_id = $2 AND lp.weakness_score >= 0.5
       ) AS ok`,
      [student.session.user.id, topicId],
    );
    expect(afterMatch!.ok).toBe(true);
  });
});

// --- what practice must never become ---------------------------------------

describe('the signal has one input', () => {
  it('social engagement does not move a topic’s learning signal', async () => {
    const topicId = await freshTopic('موضوع تدريبي');
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const app = await getApp();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(author.session),
      payload: {
        body: 'شرح موجز عن الموضوع مع مصدر.',
        visibility: 'stage',
        mediaFileIds: [],
        topicIds: [topicId],
        knowledgeType: 'explanation',
      },
    });
    const contentId = created.json<{ id: string }>().id;

    // Everything the product can observe socially, on a topic-tagged item.
    await app.inject({
      method: 'PUT',
      url: `/v1/content/${contentId}/reaction`,
      headers: auth(reader.session),
      payload: { kind: 'like' },
    });
    await app.inject({
      method: 'PUT',
      url: `/v1/content/${contentId}/bookmark`,
      headers: auth(reader.session),
      payload: { collection: null },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/content/${contentId}/view`,
      headers: auth(reader.session),
      payload: { completion: 100 },
    });

    // Learning events were recorded — that is channel B doing its job — and
    // learning_progress did not move, because none of them is an observation
    // of whether this student knows anything.
    expect(await readProgressRow(reader.session.user.id, topicId)).toBeNull();
  });
});
