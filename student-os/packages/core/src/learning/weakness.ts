/**
 * Learning signal calculations (§35).
 *
 * Naming discipline: these functions compute LEARNING SIGNALS, not learning.
 * A weakness score is evidence that a student answered questions on a topic
 * incorrectly and recently — it is not a claim about what they know. Every
 * user-facing surface built on these numbers must carry that framing.
 */

export interface TopicPerformance {
  topicId: string;
  questionsSeen: number;
  questionsCorrect: number;
  lastActivityAt: Date | null;
}

export interface WeaknessSignal {
  topicId: string;
  /** 0..1, higher means weaker. */
  weaknessScore: number;
  /**
   * 0..1 — how much the sample supports the score. Three questions is not
   * evidence of a weak topic, and the UI must be able to say so.
   */
  confidence: number;
  accuracy: number;
}

/** Below this many answered questions, a topic is not eligible for "weak topic" surfacing. */
export const MIN_QUESTIONS_FOR_CONFIDENCE = 5;

/** Sample size at which confidence saturates. */
const CONFIDENCE_SATURATION = 20;

/** Answers older than this contribute less to the recency component. */
const RECENCY_HALF_LIFE_DAYS = 14;

/**
 * Weakness combines inaccuracy with staleness:
 *   - a topic answered badly yesterday is urgent
 *   - a topic answered well six months ago is worth a refresh, but less so
 *
 * Weighted 70/30 toward accuracy: getting answers wrong is a stronger signal
 * than not having practised lately.
 */
export function computeWeakness(perf: TopicPerformance, now: Date = new Date()): WeaknessSignal {
  const seen = Math.max(0, perf.questionsSeen);
  const correct = clamp(perf.questionsCorrect, 0, seen);

  if (seen === 0) {
    return { topicId: perf.topicId, weaknessScore: 0, confidence: 0, accuracy: 0 };
  }

  const accuracy = correct / seen;
  const inaccuracy = 1 - accuracy;

  const staleness = perf.lastActivityAt
    ? 1 - Math.exp((-daysBetween(perf.lastActivityAt, now) * Math.LN2) / RECENCY_HALF_LIFE_DAYS)
    : 1;

  const weaknessScore = clamp(0.7 * inaccuracy + 0.3 * staleness, 0, 1);
  const confidence = clamp(seen / CONFIDENCE_SATURATION, 0, 1);

  return { topicId: perf.topicId, weaknessScore, confidence, accuracy };
}

/**
 * Ranks topics for the "Weak Topics" surface.
 *
 * Low-confidence topics are excluded rather than down-ranked. Telling a student
 * "you are weak in Nephrology" on the strength of two wrong answers is worse
 * than saying nothing, and it erodes trust in every other recommendation.
 */
export function rankWeakTopics(
  performances: readonly TopicPerformance[],
  now: Date = new Date(),
  limit = 10,
): WeaknessSignal[] {
  return performances
    .filter((p) => p.questionsSeen >= MIN_QUESTIONS_FOR_CONFIDENCE)
    .map((p) => computeWeakness(p, now))
    .sort((a, b) => b.weaknessScore * b.confidence - a.weaknessScore * a.confidence)
    .slice(0, limit);
}

/**
 * Quiz scoring. Partial credit for multi-select is proportional to correct
 * selections minus incorrect ones, floored at zero — otherwise selecting every
 * option would score full marks.
 */
export function scoreMultiSelect(
  selected: readonly string[],
  correct: readonly string[],
  points: number,
): number {
  if (correct.length === 0) return 0;
  const correctSet = new Set(correct);
  const selectedSet = new Set(selected);
  let hits = 0;
  let misses = 0;
  for (const id of selectedSet) {
    if (correctSet.has(id)) hits += 1;
    else misses += 1;
  }
  const raw = (hits - misses) / correct.length;
  return Math.max(0, raw) * points;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
}
