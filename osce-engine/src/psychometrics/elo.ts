/**
 * Online item difficulty calibration.
 *
 * A question bank that never learns which of its questions are hard is a bank
 * that cannot report anything useful about a student. The standard instrument
 * is Item Response Theory, but IRT calibration is a batch maximum-likelihood
 * fit over a complete response matrix: it needs hundreds of responses per item
 * before it converges, and it cannot run inside a request.
 *
 * The Elo rating system is the online alternative, and the education literature
 * has validated it specifically for this use: it updates item difficulty and
 * learner ability after every single response, costs a handful of arithmetic
 * operations, and reaches usable difficulty estimates at around 100 responses
 * per item. Reported correlation with established difficulty measures is ~0.93
 * for Elo (Glicko scores ~0.96 and is the natural upgrade path).
 *
 * The relationship to IRT is not a coincidence: Elo's expected-score function
 * is the one-parameter logistic model - the Rasch model - with a fixed
 * discrimination. Elo is therefore online Rasch estimation by stochastic
 * gradient descent, which is why the difficulty values it produces are directly
 * interpretable on the same logit scale.
 *
 * What this is NOT used for: it never gates or grades a student. It orders the
 * station-compiler pool and tells an admin which questions discriminate. A
 * ranking signal, exactly like the compiler's selection score.
 */

export interface ItemRating {
  /** Difficulty in logits. 0 is average; positive is harder. */
  readonly difficulty: number;
  /** Shrinks as evidence accumulates; drives the adaptive K factor. */
  readonly uncertainty: number;
  readonly attempts: number;
}

export interface AbilityRating {
  readonly ability: number;
  readonly uncertainty: number;
  readonly attempts: number;
}

export const INITIAL_ITEM: ItemRating = Object.freeze({
  difficulty: 0,
  uncertainty: 1,
  attempts: 0,
});

export const INITIAL_ABILITY: AbilityRating = Object.freeze({
  ability: 0,
  uncertainty: 1,
  attempts: 0,
});

/**
 * Probability that a learner of `ability` answers an item of `difficulty`
 * correctly. The Rasch / 1PL model.
 */
export function expectedScore(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(ability - difficulty)));
}

/**
 * Adaptive K factor.
 *
 * A constant K is the classic Elo weakness in education: early estimates move
 * too slowly and mature ones jitter forever. `K = base / (1 + attempts/decay)`
 * makes the first responses count heavily and later ones refine, which is the
 * behaviour the "uncertainty" column records.
 */
export function adaptiveK(attempts: number, base = 0.6, decay = 20): number {
  return base / (1 + attempts / decay);
}

export interface UpdateResult {
  readonly item: ItemRating;
  readonly ability: AbilityRating;
  /** Model's pre-update prediction. Logged so calibration can be audited. */
  readonly expected: number;
  /** Observed minus expected. The gradient. */
  readonly surprise: number;
}

/**
 * Updates item difficulty and learner ability from one graded response.
 *
 * `observed` is the partial-credit score in [0,1], not a binary outcome, so a
 * PARTIAL answer contributes proportionally rather than being forced to one
 * pole. This matches how the evaluator actually scores and avoids discarding
 * the information in partial credit.
 */
export function updateRatings(
  item: ItemRating,
  ability: AbilityRating,
  observed: number,
): UpdateResult {
  const clamped = Math.max(0, Math.min(1, observed));
  const expected = expectedScore(ability.ability, item.difficulty);
  const surprise = clamped - expected;

  const itemK = adaptiveK(item.attempts);
  const abilityK = adaptiveK(ability.attempts);

  // Signs are opposite: a learner doing better than expected raises their
  // ability and lowers the item's difficulty.
  const nextItem: ItemRating = {
    difficulty: item.difficulty - itemK * surprise,
    uncertainty: Math.max(0.05, item.uncertainty * 0.98),
    attempts: item.attempts + 1,
  };
  const nextAbility: AbilityRating = {
    ability: ability.ability + abilityK * surprise,
    uncertainty: Math.max(0.05, ability.uncertainty * 0.98),
    attempts: ability.attempts + 1,
  };

  return { item: nextItem, ability: nextAbility, expected, surprise };
}

/**
 * Wilson score lower bound for a proportion.
 *
 * Used for "percentage of students who got this right" wherever that number is
 * shown or sorted on. The naive proportion says a question answered correctly
 * once out of once has a 100% success rate, which then sorts above a question
 * with 480/500. The Wilson lower bound at 95% gives 0.21 and 0.93 respectively,
 * which is the ordering a human would actually intend.
 */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const phat = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
}

/**
 * Point-biserial correlation between an item's scores and total scores.
 *
 * The standard item-discrimination statistic. A value near zero means the item
 * does not distinguish stronger students from weaker ones; a negative value
 * means it actively rewards the weaker ones, which almost always indicates a
 * miskeyed answer or an ambiguous question. Surfacing negative-discrimination
 * items to reviewers is the highest-yield content-quality signal a question
 * bank has, and it costs one pass over the response table.
 */
export function pointBiserial(
  itemScores: readonly number[],
  totalScores: readonly number[],
): number {
  const n = Math.min(itemScores.length, totalScores.length);
  if (n < 2) return 0;

  let sumItem = 0;
  let sumTotal = 0;
  for (let i = 0; i < n; i++) {
    sumItem += itemScores[i] as number;
    sumTotal += totalScores[i] as number;
  }
  const meanItem = sumItem / n;
  const meanTotal = sumTotal / n;

  let covariance = 0;
  let varItem = 0;
  let varTotal = 0;
  for (let i = 0; i < n; i++) {
    const di = (itemScores[i] as number) - meanItem;
    const dt = (totalScores[i] as number) - meanTotal;
    covariance += di * dt;
    varItem += di * di;
    varTotal += dt * dt;
  }
  if (varItem === 0 || varTotal === 0) return 0;
  return covariance / Math.sqrt(varItem * varTotal);
}

export interface ItemDiagnostic {
  readonly questionId: string;
  readonly attempts: number;
  readonly meanScore: number;
  readonly wilsonLower: number;
  readonly difficulty: number;
  readonly discrimination: number;
  /** Set when the item looks broken and should be reviewed. */
  readonly flag: 'NEGATIVE_DISCRIMINATION' | 'TOO_EASY' | 'TOO_HARD' | 'INSUFFICIENT_DATA' | null;
}

/**
 * Flags items a reviewer should look at.
 *
 * Thresholds follow conventional classical test theory practice: a
 * point-biserial below 0 is a defect, below 0.1 is weak; a mean score above
 * 0.95 or below 0.15 carries almost no information about the student either
 * way. `minAttempts` prevents flagging noise - a question answered three times
 * has no statistics worth acting on.
 */
export function diagnose(
  questionId: string,
  itemScores: readonly number[],
  totalScores: readonly number[],
  rating: ItemRating,
  minAttempts = 30,
): ItemDiagnostic {
  const attempts = itemScores.length;
  const meanScore =
    attempts === 0 ? 0 : itemScores.reduce((a, b) => a + b, 0) / attempts;
  const successes = itemScores.filter((s) => s >= 0.999).length;
  const discrimination = pointBiserial(itemScores, totalScores);

  let flag: ItemDiagnostic['flag'] = null;
  if (attempts < minAttempts) flag = 'INSUFFICIENT_DATA';
  else if (discrimination < 0) flag = 'NEGATIVE_DISCRIMINATION';
  else if (meanScore > 0.95) flag = 'TOO_EASY';
  else if (meanScore < 0.15) flag = 'TOO_HARD';

  return {
    questionId,
    attempts,
    meanScore: round4(meanScore),
    wilsonLower: round4(wilsonLowerBound(successes, attempts)),
    difficulty: round4(rating.difficulty),
    discrimination: round4(discrimination),
    flag,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
