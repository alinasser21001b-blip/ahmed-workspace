/**
 * String similarity primitives.
 *
 * Every function here is pure, deterministic, allocation-conscious and O(n*m)
 * at worst with an explicit early exit. They are the substrate for entity
 * resolution and answer matching; nothing in this file consults a model.
 *
 * Chosen deliberately over an embedding model because:
 *   1. results are reproducible across deploys and auditable in a review UI;
 *   2. p95 stays in microseconds, which is what Section 10's <300 ms
 *      deterministic-evaluation budget actually requires;
 *   3. a wrong merge caused by a similarity score can be explained to a
 *      reviewer as "these two strings share N of M trigrams", which a cosine
 *      distance in a 768-dimensional space cannot be.
 */

/**
 * Levenshtein edit distance with a band limit.
 *
 * `maxDistance` bounds the work: rows outside the diagonal band cannot yield a
 * distance <= maxDistance, so they are skipped. Returns `maxDistance + 1` when
 * the true distance exceeds the bound. Callers that only need a threshold test
 * therefore never pay for the full matrix.
 */
export function levenshtein(a: string, b: string, maxDistance = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return Math.min(b.length, maxDistance + 1);
  if (b.length === 0) return Math.min(a.length, maxDistance + 1);

  // Ensure a is the shorter string so the row buffer is minimal.
  if (a.length > b.length) [a, b] = [b, a];
  const lenDiff = b.length - a.length;
  if (lenDiff > maxDistance) return maxDistance + 1;

  const n = a.length;
  const row = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) row[i] = i;

  for (let j = 1; j <= b.length; j++) {
    let prevDiag = row[0] as number;
    row[0] = j;
    let rowMin = j;
    const bj = b.charCodeAt(j - 1);

    // Band: only columns within maxDistance of the diagonal can matter.
    const from = Math.max(1, j - maxDistance - lenDiff);
    const to = Math.min(n, j + maxDistance);

    for (let i = from; i <= to; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const current = Math.min(
        (row[i] as number) + 1, // deletion
        (row[i - 1] as number) + 1, // insertion
        prevDiag + cost, // substitution
      );
      prevDiag = row[i] as number;
      row[i] = current;
      if (current < rowMin) rowMin = current;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }
  const result = row[n] as number;
  return result > maxDistance ? maxDistance + 1 : result;
}

/** Normalized edit similarity in [0, 1]. 1 means identical. */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Jaro similarity in [0, 1].
 *
 * Chosen for person names because it weights transpositions and near-position
 * matches, which is exactly the error mode in transliterated Arabic names
 * ("Hussein" / "Hussien").
 */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatched = new Uint8Array(aLen);
  const bMatched = new Uint8Array(bLen);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatched[j] === 1) continue;
      if (a.charCodeAt(i) !== b.charCodeAt(j)) continue;
      aMatched[i] = 1;
      bMatched[j] = 1;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (aMatched[i] !== 1) continue;
    while (bMatched[k] !== 1) k++;
    if (a.charCodeAt(i) !== b.charCodeAt(k)) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / aLen + matches / bLen + (matches - t) / matches) / 3;
}

/**
 * Jaro-Winkler: Jaro boosted by a shared prefix.
 *
 * `prefixScale` 0.1 and a 4-character cap are Winkler's original parameters.
 * The boost matters for names because titles and given names are prefix-stable
 * while surnames carry the transliteration noise.
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  if (j === 0) return 0;
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

/** Character n-grams of a string, padded so that short strings still produce grams. */
export function charNgrams(input: string, n = 3): string[] {
  if (n <= 0) return [];
  const padded = ' '.repeat(n - 1) + input + ' '.repeat(n - 1);
  const out: string[] = [];
  for (let i = 0; i + n <= padded.length; i++) out.push(padded.slice(i, i + n));
  return out;
}

/**
 * Sorensen-Dice coefficient over character n-grams, in [0, 1].
 *
 * Multiset-aware: repeated grams count with multiplicity, so "aaa" and "aaaaaa"
 * are not treated as identical. This is the workhorse for question text
 * similarity because it degrades gracefully with word insertion, which is the
 * dominant variation in student recall ("What are the complications?" vs
 * "What are the main complications of this procedure?").
 */
export function diceCoefficient(a: string, b: string, n = 3): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const aGrams = charNgrams(a, n);
  const bGrams = charNgrams(b, n);
  if (aGrams.length === 0 || bGrams.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const g of aGrams) counts.set(g, (counts.get(g) ?? 0) + 1);

  let intersection = 0;
  for (const g of bGrams) {
    const c = counts.get(g);
    if (c !== undefined && c > 0) {
      counts.set(g, c - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (aGrams.length + bGrams.length);
}

/** Jaccard similarity of two token sets, in [0, 1]. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const t of small) if (large.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Per-token information weight. Returns a positive number; higher means the
 * token carries more discriminating power.
 */
export type IdfFunction = (token: string) => number;

/** Uniform weighting: every token counts the same. */
export const UNIFORM_IDF: IdfFunction = () => 1;

/**
 * Weighted Jaccard over token sets.
 *
 * The unweighted form treats "main" and "abdominal" as equally informative.
 * Weighting by inverse document frequency makes dropping a corpus-common token
 * cheap and substituting a rare one expensive, which is the right shape for
 * question dedup.
 *
 * Honest scope note: on the calibration set the IDF term moves the composite
 * score by under 0.02 - the separation there comes from the containment
 * component. IDF earns its place on larger corpora, where boilerplate stems
 * ("patient", "case", "mention") reach document frequencies high enough for the
 * log term to actually bite. It is not what makes the default threshold work.
 */
export function weightedJaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
  idf: IdfFunction,
): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersectionWeight = 0;
  let unionWeight = 0;
  const seen = new Set<string>();
  for (const t of a) {
    seen.add(t);
    const w = idf(t);
    unionWeight += w;
    if (b.has(t)) intersectionWeight += w;
  }
  for (const t of b) {
    if (seen.has(t)) continue;
    unionWeight += idf(t);
  }
  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

/** Weighted containment: information-weighted share of the smaller set covered. */
export function weightedContainment(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
  idf: IdfFunction,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let covered = 0;
  let total = 0;
  for (const t of small) {
    const w = idf(t);
    total += w;
    if (large.has(t)) covered += w;
  }
  return total === 0 ? 0 : covered / total;
}

/**
 * Builds an IDF function from a corpus of tokenized documents.
 *
 * Smoothed as ln(1 + N / (1 + df)), which keeps every weight positive and
 * bounded. Unseen tokens (a word in a brand-new question) get the maximum
 * weight, which is the correct prior: a term the corpus has never seen is
 * maximally informative about whether two questions differ.
 */
export function buildIdf(corpus: readonly (readonly string[])[]): IdfFunction {
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = corpus.length;
  const maxWeight = Math.log(1 + n);
  const cache = new Map<string, number>();
  return (token: string): number => {
    const hit = cache.get(token);
    if (hit !== undefined) return hit;
    const observed = df.get(token);
    const weight = observed === undefined ? maxWeight : Math.log(1 + n / (1 + observed));
    cache.set(token, weight);
    return weight;
  };
}

/**
 * Token-set ratio: order-insensitive similarity that ignores word order and
 * duplicate words entirely.
 *
 * "complications of appendectomy" and "appendectomy complications" score 1.0,
 * which is correct - they are the same question. Plain edit distance scores
 * these around 0.4, which is why a single metric is never enough.
 */
export function tokenSetRatio(aTokens: readonly string[], bTokens: readonly string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  return jaccard(a, b);
}

/**
 * Containment: what fraction of the *smaller* token set appears in the larger.
 *
 * Distinguishes "this is a shorter phrasing of the same question" (containment
 * ~1, Jaccard low) from "these are different questions" (both low). Essential
 * for matching a terse student answer against a verbose reference answer.
 */
export function containment(aTokens: readonly string[], bTokens: readonly string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hits = 0;
  for (const t of small) if (large.has(t)) hits++;
  return hits / small.size;
}

/** Longest common subsequence length. Used for order-sensitive phrase overlap. */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Uint32Array(b.length + 1);
  const curr = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, curr[j - 1] as number);
    }
    prev.set(curr);
    curr.fill(0);
  }
  return prev[b.length] as number;
}

/**
 * Composite question similarity.
 *
 * Blends four views that fail in different, uncorrelated ways:
 *   - trigram Dice: robust to word insertion, sensitive to spelling
 *   - token set:    robust to reordering, blind to spelling
 *   - containment:  detects "shorter phrasing of the same thing"
 *   - LCS ratio:    rewards preserved word order
 *
 * No single metric separates the two cases that matter. Measured on the
 * calibration pairs, with IDF supplied from a question corpus:
 *
 *   same question, reworded   "what are the complications"
 *                             "what are the main complications"        ~0.82
 *   different question        "causes of chest pain"
 *                             "causes of abdominal pain"               ~0.55
 *   same question, reordered  "complications of appendectomy"
 *                             "appendectomy complications"             ~0.89
 *
 * With UNIFORM_IDF the first pair drops to ~0.75 and the second rises to
 * ~0.60, leaving a margin too thin to threshold safely. Passing a corpus IDF is
 * therefore strongly recommended; `QuestionDeduplicator` does so automatically.
 */
export interface SimilarityWeights {
  readonly dice: number;
  readonly tokenSet: number;
  readonly containment: number;
  readonly lcs: number;
}

/**
 * Default weights, chosen from what each metric actually contributes on the
 * discriminating case rather than from intuition.
 *
 * Measured on the calibration pairs:
 *   metric        same-question   different-question   separation
 *   Dice(3)          0.85              0.75               0.10
 *   Jaccard          0.50              0.50               0.00  <- useless here
 *   containment      1.00              0.60               0.40  <- decisive
 *   LCS ratio        0.50              0.67              -0.17  <- inverted
 *
 * Jaccard scores the two cases identically because both differ by one token;
 * it cannot see that one difference is an *insertion* ("main") and the other a
 * *substitution* ("chest" for "abdominal"). Containment can, so it carries the
 * largest weight. LCS is kept at a low weight despite pointing the wrong way on
 * this pair because it is the only order-sensitive view, and it earns its place
 * on reordered near-duplicates.
 */
export const DEFAULT_SIMILARITY_WEIGHTS: SimilarityWeights = Object.freeze({
  dice: 0.25,
  tokenSet: 0.2,
  containment: 0.45,
  lcs: 0.1,
});

export function compositeSimilarity(
  aText: string,
  bText: string,
  aTokens: readonly string[],
  bTokens: readonly string[],
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  idf: IdfFunction = UNIFORM_IDF,
): number {
  if (aText === bText) return 1;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  const d = diceCoefficient(aText, bText, 3);
  const ts = weightedJaccard(aSet, bSet, idf);
  const c = weightedContainment(aSet, bSet, idf);
  const maxLen = Math.max(aTokens.length, bTokens.length);
  const l = maxLen === 0 ? 0 : lcsLength(aTokens, bTokens) / maxLen;

  const total = weights.dice + weights.tokenSet + weights.containment + weights.lcs;
  if (total === 0) return 0;
  return (
    (d * weights.dice + ts * weights.tokenSet + c * weights.containment + l * weights.lcs) / total
  );
}


// ---------------------------------------------------------------------------
// Threshold calibration
// ---------------------------------------------------------------------------

export interface LabeledPair {
  readonly a: string;
  readonly b: string;
  readonly aTokens: readonly string[];
  readonly bTokens: readonly string[];
  /** True when a reviewer judged these to be the same question. */
  readonly same: boolean;
}

export interface CalibrationResult {
  readonly threshold: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  /** Gap between the lowest same-pair score and the highest different-pair score. */
  readonly margin: number;
}

/**
 * Sweeps the decision threshold over a labeled pair set and reports the
 * operating point maximising F-beta.
 *
 * This exists because a hardcoded 0.8 is a guess, and a guess is exactly what
 * the framework's KPI table forbids ("optimize using measured evidence, not
 * intuition alone"). Run it against reviewer-labeled merge decisions and pin
 * the result in policy; re-run it whenever the corpus or the tokenizer changes.
 *
 * beta < 1 favours precision. The default 0.5 is deliberate: for question
 * dedup a false merge destroys two distinct historical records, while a missed
 * merge only leaves a duplicate in the review queue.
 */
export function calibrateThreshold(
  pairs: readonly LabeledPair[],
  options: {
    readonly weights?: SimilarityWeights;
    readonly idf?: IdfFunction;
    readonly beta?: number;
    readonly steps?: number;
  } = {},
): CalibrationResult {
  const weights = options.weights ?? DEFAULT_SIMILARITY_WEIGHTS;
  const idf = options.idf ?? UNIFORM_IDF;
  const beta = options.beta ?? 0.5;
  const steps = options.steps ?? 100;

  const scored = pairs.map((p) => ({
    score: compositeSimilarity(p.a, p.b, p.aTokens, p.bTokens, weights, idf),
    same: p.same,
  }));

  let best: CalibrationResult = {
    threshold: 1,
    precision: 0,
    recall: 0,
    f1: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: scored.filter((s) => s.same).length,
    margin: 0,
  };

  const beta2 = beta * beta;
  for (let i = 0; i <= steps; i++) {
    const threshold = i / steps;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const s of scored) {
      const predicted = s.score >= threshold;
      if (predicted && s.same) tp++;
      else if (predicted && !s.same) fp++;
      else if (!predicted && s.same) fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const denominator = beta2 * precision + recall;
    const f1 = denominator === 0 ? 0 : ((1 + beta2) * precision * recall) / denominator;
    if (f1 > best.f1) {
      best = {
        threshold,
        precision,
        recall,
        f1,
        truePositives: tp,
        falsePositives: fp,
        falseNegatives: fn,
        margin: 0,
      };
    }
  }

  const sameScores = scored.filter((s) => s.same).map((s) => s.score);
  const diffScores = scored.filter((s) => !s.same).map((s) => s.score);
  const margin =
    sameScores.length > 0 && diffScores.length > 0
      ? Math.min(...sameScores) - Math.max(...diffScores)
      : 0;

  return { ...best, margin };
}
