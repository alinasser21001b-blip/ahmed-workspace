import { describe, expect, it } from 'vitest';
import { gradeSelection } from '../grading.js';

/**
 * Grading is the single source of truth for correctness, so it is tested the
 * way a source of truth should be: every shape that could plausibly be graded
 * generously, checked to make sure it is not.
 *
 * The distinction under test throughout is between `isCorrect` — which feeds
 * `learning_progress`, and therefore weakness, and therefore the feed — and
 * `pointsAwarded`, which is only ever a score a student reads. Partial credit
 * belongs to the second and must never reach the first.
 */

const options = ['a', 'b', 'c', 'd'];

describe('single-answer questions', () => {
  it('accepts exactly the right option', () => {
    expect(
      gradeSelection({ kind: 'mcq_single', correctOptionIds: ['b'], points: 2 }, ['b']),
    ).toEqual({ isCorrect: true, pointsAwarded: 2 });
  });

  it('rejects a wrong option', () => {
    expect(
      gradeSelection({ kind: 'mcq_single', correctOptionIds: ['b'], points: 2 }, ['c']),
    ).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('rejects an empty selection rather than treating it as unanswered', () => {
    // "I don't know" is an observation. Grading it as correct, or refusing to
    // grade it, would both lose the one thing it tells us.
    expect(gradeSelection({ kind: 'mcq_single', correctOptionIds: ['b'], points: 1 }, [])).toEqual(
      { isCorrect: false, pointsAwarded: 0 },
    );
  });

  it('refuses a shotgun selection that happens to contain the answer', () => {
    // Selecting everything is not a partially correct answer to a
    // single-answer question; it is a different answer.
    expect(
      gradeSelection({ kind: 'mcq_single', correctOptionIds: ['b'], points: 1 }, options),
    ).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('treats true/false the same way', () => {
    expect(
      gradeSelection({ kind: 'true_false', correctOptionIds: ['true'], points: 1 }, ['false']),
    ).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });
});

describe('multi-select questions', () => {
  const question = { kind: 'mcq_multi', correctOptionIds: ['a', 'b'], points: 4 } as const;

  it('is correct only when the selection matches the key exactly', () => {
    expect(gradeSelection(question, ['a', 'b'])).toEqual({ isCorrect: true, pointsAwarded: 4 });
  });

  it('gives partial credit for a partial answer, and does not call it correct', () => {
    const grade = gradeSelection(question, ['a']);
    expect(grade.isCorrect).toBe(false);
    expect(grade.pointsAwarded).toBeGreaterThan(0);
    expect(grade.pointsAwarded).toBeLessThan(4);
  });

  it('penalises a wrong pick alongside a right one', () => {
    expect(gradeSelection(question, ['a', 'c']).pointsAwarded).toBe(0);
    expect(gradeSelection(question, ['a', 'c']).isCorrect).toBe(false);
  });

  it('gives nothing for selecting every option', () => {
    expect(gradeSelection(question, options)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('ignores duplicate selections rather than double-counting them', () => {
    expect(gradeSelection(question, ['a', 'a', 'b', 'b'])).toEqual({
      isCorrect: true,
      pointsAwarded: 4,
    });
  });

  it('order does not matter', () => {
    expect(gradeSelection(question, ['b', 'a'])).toEqual({ isCorrect: true, pointsAwarded: 4 });
  });
});

describe('a question with no key', () => {
  it('is never correct, whatever is selected', () => {
    // An authoring error. Awarding the point would write a false signal into
    // learning_progress that nothing downstream could tell from a real one.
    for (const selection of [[], ['a'], options]) {
      expect(
        gradeSelection({ kind: 'mcq_single', correctOptionIds: [], points: 3 }, selection),
      ).toEqual({ isCorrect: false, pointsAwarded: 0 });
      expect(
        gradeSelection({ kind: 'mcq_multi', correctOptionIds: [], points: 3 }, selection),
      ).toEqual({ isCorrect: false, pointsAwarded: 0 });
    }
  });
});
