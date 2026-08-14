/**
 * Grading — the single source of truth for whether an answer is correct.
 *
 * Pure and I/O-free, like the rest of `@sos/core`, and deliberately the ONLY
 * place this decision is made. The alternative that suggests itself — a
 * `CASE WHEN` in the insert, or a boolean the client posts alongside its
 * selection — is exactly the shape that lets two answers to the same question
 * disagree, and one of them would be the one a student's weakness score is
 * built from.
 *
 * The client never sends correctness and never receives it before it answers.
 * `is_correct` on `quiz_answers` is written from this function's verdict and
 * from nothing else.
 */

import { scoreMultiSelect } from './weakness.js';

/** The question kinds practice can grade. `short_answer` is not one of them. */
export type GradableQuestionKind = 'mcq_single' | 'mcq_multi' | 'true_false';

export interface GradableQuestion {
  kind: GradableQuestionKind;
  /** Option ids marked correct by the author. Never sent to the client. */
  correctOptionIds: readonly string[];
  points: number;
}

export interface Grade {
  /**
   * Whether this counts as a correct answer.
   *
   * Binary, and strict: the selection must match the key exactly. Partial
   * credit exists for the *score* a student sees, but `questions_correct` is a
   * count of questions they got right, and half-right is not right. Letting
   * partial credit leak into the count would make accuracy — and therefore
   * weakness — quietly optimistic.
   */
  isCorrect: boolean;
  /** 0..points. Proportional for multi-select, all-or-nothing otherwise. */
  pointsAwarded: number;
}

/**
 * Grades one selection against the author's key.
 *
 * A question with no correct option is ungradable rather than universally
 * correct: it is an authoring error, and awarding a point for it would put a
 * false signal into `learning_progress` that nothing downstream could
 * distinguish from a real one.
 */
export function gradeSelection(
  question: GradableQuestion,
  selectedOptionIds: readonly string[],
): Grade {
  const key = new Set(question.correctOptionIds);
  if (key.size === 0) return { isCorrect: false, pointsAwarded: 0 };

  const selected = new Set(selectedOptionIds);

  if (question.kind === 'mcq_single' || question.kind === 'true_false') {
    // Exactly one choice. Selecting two options on a single-answer question is
    // not a partially correct answer; it is a different answer.
    const isCorrect = selected.size === 1 && key.has([...selected][0] as string);
    return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
  }

  const isCorrect =
    selected.size === key.size && [...selected].every((id) => key.has(id));

  /*
   * Partial credit for the score, from the function that has computed it since
   * Phase 0. Not reimplemented here: `scoreMultiSelect` is already the product's
   * answer to "how much is a half-right multi-select worth", and a second
   * answer is the drift the parity discipline exists to prevent.
   */
  return {
    isCorrect,
    pointsAwarded: scoreMultiSelect([...selected], [...key], question.points),
  };
}
