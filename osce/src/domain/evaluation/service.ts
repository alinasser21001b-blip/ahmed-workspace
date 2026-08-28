import type { Correctness, EvaluationResult, Question } from '../models';
import { scoreToCorrectness } from '../models';
import { jaccard, tokenSet } from '../text/arabic';

export interface EvaluationInput {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
  explanation?: string;
}

/**
 * EvaluationService abstraction.
 * Do not couple the exam UI or session engine to a specific AI provider.
 * The expected answer from the knowledge base is the authority.
 */
export interface EvaluationService {
  evaluate(input: EvaluationInput): Promise<EvaluationResult> | EvaluationResult;
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'with',
  'on',
  'is',
  'are',
  'be',
  'as',
  'by',
  'from',
  'that',
  'this',
  'it',
  'if',
  'not',
  'also',
  'usually',
  'typically',
  'including',
  'according',
  'protocol',
]);

function splitPoints(expected: string): string[] {
  return expected
    .split(/[.;\n]|(?:\s+and\s+)|(?:،)/g)
    .map((part) => part.replace(/^[-–—*•]\s*/, '').trim())
    .filter((part) => part.length > 8);
}

function significantTokens(text: string): Set<string> {
  const tokens = tokenSet(text);
  for (const t of [...tokens]) {
    if (STOP.has(t) || t.length < 3) tokens.delete(t);
  }
  return tokens;
}

/**
 * Heuristic evaluator: compares the student answer to the curated expected
 * answer only. It must not invent medical facts.
 */
export function evaluateAgainstKey(input: EvaluationInput): EvaluationResult {
  const student = input.studentAnswer.trim();
  if (!student) {
    const points = splitPoints(input.expectedAnswer);
    return {
      score: 0,
      correctness: 'INCORRECT',
      coveredPoints: [],
      missingPoints: points.slice(0, 8),
      feedback: 'No written answer. Compare your mental answer with the expected points.',
      confidence: 0.4,
      source: 'heuristic',
    };
  }

  const expectedTokens = significantTokens(input.expectedAnswer);
  const studentTokens = significantTokens(student);
  const overlap = jaccard(expectedTokens, studentTokens);

  const points = splitPoints(input.expectedAnswer);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const point of points) {
    const pointTokens = significantTokens(point);
    const hit = jaccard(pointTokens, studentTokens);
    if (hit >= 0.28 || [...pointTokens].some((t) => t.length > 4 && studentTokens.has(t))) {
      covered.push(point);
    } else {
      missing.push(point);
    }
  }

  let score: number;
  if (points.length >= 2) {
    score = covered.length / points.length;
  } else {
    score = overlap;
  }

  // Exact-ish short answers such as a diagnosis.
  const compactExpected = [...expectedTokens].sort().join(' ');
  const compactStudent = [...studentTokens].sort().join(' ');
  if (compactExpected && compactExpected === compactStudent) score = 1;
  if (overlap >= 0.9) score = Math.max(score, 0.95);

  score = Math.max(0, Math.min(1, score));
  const correctness: Correctness = scoreToCorrectness(score);

  let feedback: string;
  if (correctness === 'CORRECT') {
    feedback = 'Your answer covers the expected points from the knowledge base.';
  } else if (correctness === 'PARTIAL') {
    const missed = missing[0] ? ` Missing: ${missing[0]}` : '';
    feedback = `Partial match with the expected answer.${missed}`;
  } else {
    feedback = 'The written answer does not match the expected knowledge-base points.';
  }

  return {
    score: Math.round(score * 100) / 100,
    correctness,
    coveredPoints: covered.slice(0, 8),
    missingPoints: missing.slice(0, 8),
    feedback,
    confidence: points.length >= 2 ? 0.7 : 0.55,
    source: 'heuristic',
  };
}

export class HeuristicEvaluationService implements EvaluationService {
  evaluate(input: EvaluationInput): EvaluationResult {
    return evaluateAgainstKey(input);
  }
}

export function evaluationFromSelfGrade(correctness: Correctness): EvaluationResult {
  const score = correctness === 'CORRECT' ? 1 : correctness === 'PARTIAL' ? 0.5 : 0;
  return {
    score,
    correctness,
    coveredPoints: [],
    missingPoints: [],
    feedback: 'Self-evaluated by the student.',
    confidence: 1,
    source: 'self',
  };
}

export function mergeEvaluation(
  automatic: EvaluationResult,
  self: Correctness | undefined,
): EvaluationResult {
  if (!self) return automatic;
  const overlay = evaluationFromSelfGrade(self);
  return {
    ...automatic,
    score: overlay.score,
    correctness: overlay.correctness,
    source: 'self',
    feedback: `${automatic.feedback} Final mark is the student's self-evaluation.`,
  };
}

export function questionToEvaluationInput(
  question: Question,
  studentAnswer: string,
): EvaluationInput {
  return {
    question: question.questionText,
    expectedAnswer: question.expectedAnswer,
    studentAnswer,
    explanation: question.explanation,
  };
}
