import type { ExaminerQuestion, Question } from '../models';
import { shuffle } from '../../lib/ids';

export interface SelectionInput {
  departmentId: string;
  examinerId: string;
  caseId: string;
  examinerQuestions: readonly ExaminerQuestion[];
  questions: readonly Question[];
  /** Reserved for later FSRS / weakness weighting. */
  weaknessWeightByQuestionId?: Readonly<Record<string, number>>;
}

export interface SelectionWeights {
  examinerFrequencyWeight: number;
  recurrenceWeight: number;
  relevanceWeight: number;
  recencyWeight: number;
  weaknessWeight: number;
}

export const DEFAULT_WEIGHTS: SelectionWeights = {
  examinerFrequencyWeight: 1,
  recurrenceWeight: 1,
  relevanceWeight: 1,
  recencyWeight: 0.4,
  weaknessWeight: 0,
};

/**
 * questionPriority =
 *   examinerFrequencyWeight * recurrenceWeight * relevanceWeight * weaknessWeight
 *
 * First implementation uses frequency and recency, then a light shuffle so
 * the station is not identical every time. Invalid (other examiner / other
 * case / other specialty) questions are never admitted.
 */
export function questionPriority(
  eq: ExaminerQuestion,
  question: Question,
  currentYear: number,
  weights: SelectionWeights = DEFAULT_WEIGHTS,
  weakness = 1,
): number {
  const frequency = 1 + eq.timesObserved * weights.examinerFrequencyWeight;
  const recurrence = 1 + eq.yearsObserved.length * weights.recurrenceWeight;
  const sameCase = question.caseId === eq.caseId ? 1 : 0;
  const relevance = sameCase * weights.relevanceWeight;
  const last = eq.lastObserved ?? currentYear;
  const recency = 1 + Math.max(0, 3 - (currentYear - last)) * weights.recencyWeight;
  const weaknessFactor = 1 + weakness * weights.weaknessWeight;
  return frequency * recurrence * relevance * recency * weaknessFactor;
}

export function selectQuestionSequence(
  input: SelectionInput,
  options: {
    random?: () => number;
    weights?: SelectionWeights;
    currentYear?: number;
  } = {},
): string[] {
  const random = options.random ?? Math.random;
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const currentYear = options.currentYear ?? new Date().getUTCFullYear();

  const questionById = new Map(input.questions.map((question) => [question.id, question]));

  const pool = input.examinerQuestions.filter((eq) => {
    if (eq.examinerId !== input.examinerId) return false;
    if (eq.caseId !== input.caseId) return false;
    const question = questionById.get(eq.questionId);
    if (!question) return false;
    if (question.caseId !== input.caseId) return false;
    return true;
  });

  const unique = new Map<string, ExaminerQuestion>();
  for (const eq of pool) {
    const existing = unique.get(eq.questionId);
    if (!existing || eq.timesObserved > existing.timesObserved) unique.set(eq.questionId, eq);
  }

  const ranked = [...unique.values()]
    .map((eq) => {
      const question = questionById.get(eq.questionId);
      if (!question) return null;
      const weakness = input.weaknessWeightByQuestionId?.[eq.questionId] ?? 0;
      return {
        questionId: eq.questionId,
        priority: questionPriority(eq, question, currentYear, weights, weakness),
      };
    })
    .filter((row): row is { questionId: string; priority: number } => row !== null)
    .sort((a, b) => b.priority - a.priority);

  // Mild shuffle within adjacent priority bands so order is not frozen.
  const jittered = ranked.map((row) => ({
    ...row,
    sortKey: row.priority + random() * 0.15,
  }));
  jittered.sort((a, b) => b.sortKey - a.sortKey);

  if (jittered.length === 0) {
    return [];
  }

  return jittered.map((row) => row.questionId);
}

export function orderedWithFallbackShuffle(ids: readonly string[], random?: () => number): string[] {
  return shuffle(ids, random);
}
