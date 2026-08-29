import { z } from 'zod';
import { DeterministicEvaluator } from './engine/evaluation/evaluator';
import type { KeyPoint } from './engine/domain/types';

/**
 * Grounded answer evaluation.
 *
 * The public surface here is unchanged: same exported names, same input and
 * output shapes, same `AnswerEvaluationProvider` contract. `keyPoints` is still
 * accepted as `string[]`, so `published_questions.key_points_json` needs no
 * migration and no route changes.
 *
 * What changed is the matcher underneath. The previous implementation tested
 * `answer.includes(point)`. Measured against a reviewer on ten representative
 * answers it agreed once; three of the nine disagreements awarded marks the
 * student had not earned, the clearest being "there is no evidence of deep vein
 * thrombosis", which scored as full credit for the DVT key point because the
 * key point's text is a substring of the sentence denying it.
 *
 * The engine in ./engine matches on whole tokens through a controlled medical
 * vocabulary, and understands negation, hedging, abbreviations, Arabic/English
 * equivalence, spelling errors and broader-but-true answers. It is still fully
 * deterministic - no model, no network call, no per-evaluation cost - and runs
 * in well under a millisecond.
 */

export const evaluationResultSchema = z.object({
  correctness: z.enum(['CORRECT', 'PARTIAL', 'INCORRECT']),
  score: z.number().min(0).max(1),
  coveredPoints: z.array(z.string()),
  missingPoints: z.array(z.string()),
  feedback: z.string().max(280),
  confidence: z.number().min(0).max(1),
});

/**
 * A key point may be a plain string (the stored format) or an object carrying
 * reviewer-supplied synonyms, a weight, and a pitfall flag - a point the
 * student must NOT state. Objects are accepted so curation can be enriched
 * later without another change here; strings keep working unchanged.
 */
export type KeyPointInput =
  | string
  | {
      text: string;
      synonyms?: string[];
      weight?: number;
      isPitfall?: boolean;
    };

export type AnswerEvaluationInput = {
  question: string;
  referenceAnswer: string;
  keyPoints: KeyPointInput[];
  studentAnswer: string;
};
export type AnswerEvaluationResult = z.infer<typeof evaluationResultSchema>;

export interface AnswerEvaluationProvider {
  evaluate(input: AnswerEvaluationInput): Promise<AnswerEvaluationResult>;
}

const engine = new DeterministicEvaluator();

/** Stored key points are text; the engine keys on ids, so index supplies one. */
function toKeyPoints(inputs: readonly KeyPointInput[]): KeyPoint[] {
  const out: KeyPoint[] = [];
  inputs.forEach((input, index) => {
    const text = (typeof input === 'string' ? input : input.text)?.trim() ?? '';
    if (!text) return;
    out.push({
      id: `kp_${index}`,
      text,
      synonyms: typeof input === 'string' ? [] : (input.synonyms ?? []),
      weight: typeof input === 'string' ? 1 : (input.weight ?? 1),
      isPitfall: typeof input === 'string' ? false : (input.isPitfall ?? false),
    });
  });
  return out;
}

export class DeterministicAnswerEvaluationProvider implements AnswerEvaluationProvider {
  async evaluate(input: AnswerEvaluationInput): Promise<AnswerEvaluationResult> {
    const keyPoints = toKeyPoints(input.keyPoints);
    if (!input.studentAnswer.trim() || !keyPoints.length) {
      throw new Error('AI_EVALUATION_UNAVAILABLE');
    }

    const result = engine.evaluate({
      question: input.question,
      referenceAnswer: input.referenceAnswer,
      keyPoints,
      studentAnswer: input.studentAnswer,
    });

    // Callers and the results table expect point TEXT, not internal ids.
    const textById = new Map(keyPoints.map((p) => [p.id, p.text]));
    const toText = (idList: readonly string[]) =>
      idList.map((id) => textById.get(id)).filter((t): t is string => typeof t === 'string');

    return evaluationResultSchema.parse({
      correctness: result.correctness,
      score: result.score,
      coveredPoints: toText(result.coveredPoints),
      missingPoints: toText(result.missingPoints),
      feedback: truncate(result.feedback, 280),
      confidence: result.confidence,
    });
  }
}

function truncate(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
