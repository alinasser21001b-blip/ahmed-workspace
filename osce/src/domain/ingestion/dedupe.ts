import { jaccard, tokenSet } from '../text/arabic';
import type { Question } from '../models';

export interface DedupeResult {
  canonicalId?: string;
  isDuplicate: boolean;
  similarity: number;
}

const DUPLICATE_THRESHOLD = 0.72;

export function questionSimilarity(a: string, b: string): number {
  return jaccard(tokenSet(a), tokenSet(b));
}

export function findCanonicalQuestion(
  incoming: string,
  existing: readonly Question[],
  caseId?: string,
): DedupeResult {
  let best: { id: string; similarity: number } | undefined;
  for (const question of existing) {
    if (caseId && question.caseId !== caseId) continue;
    const similarity = Math.max(
      questionSimilarity(incoming, question.canonicalQuestion),
      questionSimilarity(incoming, question.questionText),
      ...question.observedVariants.map((variant) => questionSimilarity(incoming, variant)),
    );
    if (!best || similarity > best.similarity) best = { id: question.id, similarity };
  }
  if (best && best.similarity >= DUPLICATE_THRESHOLD) {
    return { canonicalId: best.id, isDuplicate: true, similarity: best.similarity };
  }
  return { isDuplicate: false, similarity: best?.similarity ?? 0 };
}

export function mergeVariant(question: Question, observed: string): Question {
  if (question.questionText === observed || question.observedVariants.includes(observed)) {
    return question;
  }
  return { ...question, observedVariants: [...question.observedVariants, observed] };
}
