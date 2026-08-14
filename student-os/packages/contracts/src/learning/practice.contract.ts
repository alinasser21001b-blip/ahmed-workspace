import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * Practice — the observation the learner model was missing.
 *
 * Everything downstream of a student's own performance (`learning_progress`,
 * weakness, the Learn tab's focus topics, the feed's weak-topic term) has
 * existed since Phase 0 with nothing feeding it, because the product never
 * asked a student a question it knew the answer to. This is that question.
 *
 * The contract is deliberately small. It is not a quiz product: there is one
 * way in (a topic), one thing to do (answer), and one thing that comes back
 * (whether you were right, and what the system now knows about you). No
 * scheduler, no streak, no recommendation.
 *
 * Two shapes are load-bearing:
 *
 *  * `practiceQuestionSchema` has **no correctness field**. The key is not sent
 *    to the client before it answers, and no client-supplied verdict is ever
 *    trusted — grading happens in `@sos/core` and is written from there.
 *  * `topicProgressSchema` is what the student is told about themselves, and it
 *    carries `lowConfidence` beside the score for the same reason the Learn tab
 *    does: a weakness computed from two answers is not a finding, and
 *    presenting it as one is the overclaim this product is defined against.
 */

// --- what the system now knows about this student ---------------------------

export const topicProgressSchema = z.object({
  topicId: uuidSchema,
  questionsSeen: z.number().int().nonnegative(),
  questionsCorrect: z.number().int().nonnegative(),
  /** 0..1, higher means weaker. Computed in `@sos/core`, never in SQL. */
  weaknessScore: z.number().min(0).max(1),
  /** 0..1 — how far the sample supports the score. */
  confidence: z.number().min(0).max(1),
  /** True while the sample is too small to conclude anything from. */
  lowConfidence: z.boolean(),
  lastActivityAt: isoDateTimeSchema.nullable(),
});
export type TopicProgress = z.infer<typeof topicProgressSchema>;

// --- the session ------------------------------------------------------------

/**
 * Kinds practice can ask.
 *
 * `short_answer` is excluded rather than half-supported: grading free text
 * against `accepted_answers` is a matching problem with its own failure modes,
 * and a wrong verdict here writes a permanent, wrong learning signal. Those
 * questions are filtered out of the session in SQL, not hidden in the client.
 */
export const practiceQuestionKindSchema = z.enum(['mcq_single', 'mcq_multi', 'true_false']);
export type PracticeQuestionKind = z.infer<typeof practiceQuestionKindSchema>;

export const practiceOptionSchema = z.object({
  id: uuidSchema,
  label: z.string(),
});

export const practiceQuestionSchema = z.object({
  id: uuidSchema,
  kind: practiceQuestionKindSchema,
  prompt: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().positive(),
  options: z.array(practiceOptionSchema),
  /** Already answered in this attempt, so the client can resume rather than re-ask. */
  answered: z.boolean(),
});
export type PracticeQuestion = z.infer<typeof practiceQuestionSchema>;

export const practiceSessionSchema = z.object({
  attemptId: uuidSchema,
  quizId: uuidSchema,
  quizTitle: z.string(),
  topicId: uuidSchema,
  topicName: z.string(),
  questions: z.array(practiceQuestionSchema),
  /** Where the student already stands on this topic, before answering anything. */
  progress: topicProgressSchema,
});
export type PracticeSession = z.infer<typeof practiceSessionSchema>;

// --- answering --------------------------------------------------------------

export const submitPracticeAnswerRequestSchema = z.object({
  questionId: uuidSchema,
  /**
   * The student's selection. An empty array is a valid answer — "I don't know"
   * is an observation, and recording it as a wrong answer is more honest than
   * letting the student skip out of a topic they are weak in.
   */
  selectedOptionIds: z.array(uuidSchema).max(16),
});
export type SubmitPracticeAnswerRequest = z.infer<typeof submitPracticeAnswerRequestSchema>;

export const practiceAnswerResultSchema = z.object({
  questionId: uuidSchema,
  isCorrect: z.boolean(),
  /** Revealed only after answering. */
  correctOptionIds: z.array(uuidSchema),
  explanation: z.string().nullable(),
  pointsAwarded: z.number().nonnegative(),
  /**
   * True when this question had already been answered in this attempt and the
   * submission changed nothing. The result is the stored one; no counter moved.
   */
  alreadyAnswered: z.boolean(),
  /** Every question in the attempt is now answered, and the attempt is closed. */
  attemptCompleted: z.boolean(),
  /**
   * The learning signal as it stands after this answer.
   *
   * Null when the question carries no topic. The answer is still recorded — it
   * happened — but it cannot roll up, because progress is per-topic and there
   * is no topic to attribute it to. Reporting a zeroed row instead would tell
   * the student something false about a topic they were never asked about.
   */
  progress: topicProgressSchema.nullable(),
});
export type PracticeAnswerResult = z.infer<typeof practiceAnswerResultSchema>;
