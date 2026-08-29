/**
 * Fellegi-Sunter probabilistic record linkage.
 *
 * The framework's Section 5 gives examiner resolution a three-valued contract -
 * MATCHED / NEW_CANDIDATE / AMBIGUOUS - but not a principled way to decide
 * which one applies. A raw similarity score cannot supply that: 0.87 is not a
 * probability of anything, and a threshold on it is a guess whose error rate is
 * unmeasurable.
 *
 * Fellegi-Sunter (1969) is the standard answer, and the model underneath Splink
 * and most national record-linkage systems. For each comparison field it needs
 * two probabilities:
 *
 *   m = P(fields agree | the records are the SAME entity)
 *   u = P(fields agree | the records are DIFFERENT entities)
 *
 * The evidence a field contributes is its log Bayes factor:
 *
 *   agreement    -> log2(m / u)          (positive: pushes toward match)
 *   disagreement -> log2((1-m) / (1-u))  (negative: pushes toward non-match)
 *
 * Summing over independent fields and adding the log prior odds gives total
 * match weight, which converts to a posterior probability. That number *is* a
 * probability, so the two thresholds separating the three outcomes can be set
 * from a stated error tolerance rather than from taste.
 *
 * The parameters here are informed priors, not EM-fitted estimates. Fitting
 * them requires labelled reviewer decisions, which a new deployment does not
 * have; `refineWithEm` is provided to fit them once that data exists. Until
 * then the priors are deliberately pessimistic about agreement, which widens
 * the AMBIGUOUS band and sends more decisions to a human. That is the correct
 * direction to be wrong in: the framework tolerates zero incorrect examiner
 * auto-merges, and an over-wide ambiguous band costs reviewer time, not data
 * integrity.
 */

export interface ComparisonLevel {
  /** Human-readable name for this agreement level, shown in the review UI. */
  readonly name: string;
  /** P(this level | records are the same entity). */
  readonly m: number;
  /** P(this level | records are different entities). */
  readonly u: number;
}

export interface ComparisonField<T> {
  readonly name: string;
  /**
   * Assigns a comparison level index by comparing two records.
   * Level 0 is conventionally "disagreement".
   */
  compare(a: T, b: T): number;
  /** Ordered levels; index returned by `compare` selects one. */
  readonly levels: readonly ComparisonLevel[];
  /**
   * Relative importance multiplier applied to this field's log Bayes factor.
   * Defaults to 1. Used to damp fields known to be correlated with another.
   */
  readonly weight?: number;
}

export interface FieldEvidence {
  readonly field: string;
  readonly level: string;
  readonly m: number;
  readonly u: number;
  /** log2 Bayes factor contributed by this field. */
  readonly logBayesFactor: number;
}

export interface MatchScore {
  /** Sum of field log Bayes factors plus log prior odds. */
  readonly matchWeight: number;
  /** Posterior probability that the two records are the same entity. */
  readonly probability: number;
  /** Per-field breakdown. This is what makes a merge decision explainable. */
  readonly evidence: readonly FieldEvidence[];
}

/**
 * Prior odds that two records drawn from the same block are the same entity.
 *
 * Blocking already removed the overwhelming majority of non-matching pairs, so
 * the within-block prior is far higher than the corpus-wide 1/N. A default of
 * 0.1 corresponds to "roughly one in ten pairs sharing a phonetic block are
 * actually the same person", which is conservative for examiner names.
 */
export const DEFAULT_PRIOR = 0.1;

export function scorePair<T>(
  a: T,
  b: T,
  fields: readonly ComparisonField<T>[],
  prior = DEFAULT_PRIOR,
): MatchScore {
  const evidence: FieldEvidence[] = [];
  let totalWeight = Math.log2(prior / (1 - prior));

  for (const field of fields) {
    const levelIndex = field.compare(a, b);
    const level = field.levels[levelIndex];
    if (level === undefined) continue;

    // Guard against 0 and 1, which would make the log infinite.
    const m = clampProbability(level.m);
    const u = clampProbability(level.u);
    const logBayesFactor = Math.log2(m / u) * (field.weight ?? 1);

    evidence.push({
      field: field.name,
      level: level.name,
      m,
      u,
      logBayesFactor,
    });
    totalWeight += logBayesFactor;
  }

  return {
    matchWeight: totalWeight,
    probability: sigmoid2(totalWeight),
    evidence,
  };
}

function clampProbability(p: number): number {
  return Math.min(0.999999, Math.max(0.000001, p));
}

/** Converts a base-2 log-odds to a probability. */
function sigmoid2(logOdds2: number): number {
  const odds = Math.pow(2, logOdds2);
  return odds / (1 + odds);
}

export type Decision = 'MATCH' | 'AMBIGUOUS' | 'NO_MATCH';

export interface DecisionThresholds {
  /** Posterior at or above which an automatic match is permitted. */
  readonly matchAbove: number;
  /** Posterior at or below which the pair is dismissed without review. */
  readonly noMatchBelow: number;
}

/**
 * Default thresholds.
 *
 * `matchAbove` 0.99 follows directly from the KPI "incorrect examiner
 * auto-merge: 0 tolerated". At 0.99, one automatic merge in a hundred is
 * expected to be wrong, which is already too many for examiners - which is why
 * `ExaminerResolver` additionally refuses to auto-merge at all unless the
 * names are exactly equal after normalization or an explicit alias exists.
 * These thresholds govern *suggestion strength*, and the entity-specific policy
 * governs what a given strength is allowed to do.
 */
export const DEFAULT_THRESHOLDS: DecisionThresholds = Object.freeze({
  matchAbove: 0.99,
  noMatchBelow: 0.5,
});

export function decide(
  score: MatchScore,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): Decision {
  if (score.probability >= thresholds.matchAbove) return 'MATCH';
  if (score.probability <= thresholds.noMatchBelow) return 'NO_MATCH';
  return 'AMBIGUOUS';
}

/**
 * One EM iteration over unlabelled pairs, refining m and u.
 *
 * Standard Fellegi-Sunter EM: treat match status as the latent variable, use
 * the current parameters to compute each pair's posterior, then re-estimate m
 * and u as posterior-weighted agreement rates.
 *
 * Provided so a deployment can replace the informed priors with fitted values
 * once it has a corpus, closing the loop the framework asks for under
 * "benchmark extraction against a labeled corpus". Returns new level parameters
 * and the log-likelihood, so a caller can iterate to convergence and see it.
 */
export function emIteration<T>(
  pairs: readonly (readonly [T, T])[],
  fields: readonly ComparisonField<T>[],
  prior: number,
): {
  fields: ComparisonField<T>[];
  prior: number;
  meanPosterior: number;
} {
  if (pairs.length === 0) return { fields: [...fields], prior, meanPosterior: 0 };

  // E-step: posterior match probability for every pair under current parameters.
  const posteriors = pairs.map(([a, b]) => scorePair(a, b, fields, prior).probability);
  const meanPosterior = posteriors.reduce((s, p) => s + p, 0) / posteriors.length;

  // M-step: posterior-weighted level frequencies.
  const updated = fields.map((field) => {
    const matchMass = new Array(field.levels.length).fill(0);
    const nonMatchMass = new Array(field.levels.length).fill(0);

    pairs.forEach(([a, b], index) => {
      const level = field.compare(a, b);
      if (level < 0 || level >= field.levels.length) return;
      const posterior = posteriors[index] as number;
      matchMass[level] += posterior;
      nonMatchMass[level] += 1 - posterior;
    });

    const totalMatch = matchMass.reduce((s: number, v: number) => s + v, 0);
    const totalNonMatch = nonMatchMass.reduce((s: number, v: number) => s + v, 0);

    const levels = field.levels.map((level, index) => ({
      name: level.name,
      // Laplace smoothing keeps a level that never occurred from collapsing to 0.
      m: totalMatch === 0 ? level.m : (matchMass[index] + 1) / (totalMatch + field.levels.length),
      u:
        totalNonMatch === 0
          ? level.u
          : (nonMatchMass[index] + 1) / (totalNonMatch + field.levels.length),
    }));

    return { ...field, levels };
  });

  return { fields: updated, prior: meanPosterior, meanPosterior };
}

/** Runs EM to convergence or `maxIterations`, whichever comes first. */
export function refineWithEm<T>(
  pairs: readonly (readonly [T, T])[],
  fields: readonly ComparisonField<T>[],
  options: { prior?: number; maxIterations?: number; tolerance?: number } = {},
): { fields: ComparisonField<T>[]; prior: number; iterations: number; converged: boolean } {
  let currentFields = [...fields];
  let currentPrior = options.prior ?? DEFAULT_PRIOR;
  const maxIterations = options.maxIterations ?? 20;
  const tolerance = options.tolerance ?? 1e-4;

  for (let i = 1; i <= maxIterations; i++) {
    const result = emIteration(pairs, currentFields, currentPrior);
    const delta = Math.abs(result.prior - currentPrior);
    currentFields = result.fields;
    currentPrior = result.prior;
    if (delta < tolerance) {
      return { fields: currentFields, prior: currentPrior, iterations: i, converged: true };
    }
  }
  return {
    fields: currentFields,
    prior: currentPrior,
    iterations: maxIterations,
    converged: false,
  };
}
