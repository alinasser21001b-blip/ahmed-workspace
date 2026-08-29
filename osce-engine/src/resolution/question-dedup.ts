/**
 * Question deduplication: the nine-step pipeline of Section 5.
 *
 *   1. normalize text
 *   2. exact normalized match
 *   3. abbreviation-safe match within case context
 *   4. string similarity
 *   5. optional semantic similarity
 *   6. propose canonical target
 *   7. reviewer merges or keeps separate
 *   8. preserve observed wording as QuestionVariant
 *   9. create approved QuestionOccurrence
 *
 * Steps 1-6 live here. Steps 7-9 belong to review and publish, because they
 * involve a human decision and a transaction respectively.
 *
 * Step 5 is where the framework leaves room for a semantic model. This
 * implementation fills it deterministically: concept-set comparison through the
 * controlled vocabulary. "What are the complications of DVT" and "ما هي مضاعفات
 * الجلطة الوريدية العميقة" share the concept set {C:COMPLICATION-ish, C:DVT}
 * despite sharing not one character. That is semantic matching without a model,
 * and unlike an embedding it can name the concepts it matched on.
 */

import type { CaseId, Question, QuestionCategory, QuestionId } from '../domain/types.ts';
import { normalizeForMatching } from '../text/normalize.ts';
import { tokenize } from '../text/tokenize.ts';
import {
  DEFAULT_SIMILARITY_WEIGHTS,
  buildIdf,
  compositeSimilarity,
  jaccard,
  UNIFORM_IDF,
  type IdfFunction,
  type SimilarityWeights,
} from '../text/similarity.ts';
import { MinHasher, LshIndex } from '../text/simhash.ts';
import { Lexicon, defaultLexicon } from '../text/lexicon.ts';

export type DedupDecisionKind = 'EXACT' | 'STRONG_SUGGESTION' | 'WEAK_SUGGESTION' | 'DISTINCT';

export interface DedupCandidateMatch {
  readonly questionId: QuestionId;
  readonly canonicalText: string;
  readonly kind: DedupDecisionKind;
  /** Composite lexical similarity, 0..1. */
  readonly lexicalScore: number;
  /** Jaccard over concept sets, 0..1. Null when neither text has concepts. */
  readonly conceptScore: number | null;
  /** Concepts both texts named. The explanation shown to a reviewer. */
  readonly sharedConcepts: readonly string[];
  /** Which pipeline step produced this match. */
  readonly matchedBy: 'exact-normalized' | 'concept-set' | 'lexical-similarity';
}

export interface DedupResult {
  /** Best match, if any cleared the weak threshold. */
  readonly best: DedupCandidateMatch | null;
  /** All matches above the weak threshold, best first. */
  readonly matches: readonly DedupCandidateMatch[];
  /** Number of pairs actually scored. Blocking effectiveness metric. */
  readonly comparisons: number;
}

export interface DedupThresholds {
  /**
   * At or above this, the engine proposes a merge with high confidence.
   * Calibrated at 0.63 on the reference labelled set with `calibrateThreshold`;
   * raised to 0.78 here because that calibration optimised F0.5 on a small set
   * and the operating point should sit above, not at, the measured boundary.
   */
  readonly strong: number;
  /** At or above this, the pair is shown to a reviewer as a possible duplicate. */
  readonly weak: number;
  /** Concept-set Jaccard at or above which two texts are treated as equivalent. */
  readonly conceptStrong: number;
  /**
   * Minimum shared concepts before concept agreement may promote a pair.
   *
   * One shared concept is not evidence. Two questions that both mention DVT
   * have concept-set Jaccard 1.0 when DVT is the only concept either names -
   * a degenerate perfect score carrying no information. "What are the
   * complications of DVT" and "What investigations would you order for DVT"
   * are the same concept set and different questions.
   */
  readonly minSharedConcepts: number;
}

export const DEFAULT_DEDUP_THRESHOLDS: DedupThresholds = Object.freeze({
  strong: 0.78,
  weak: 0.6,
  conceptStrong: 0.8,
  minSharedConcepts: 2,
});

export interface QuestionRecord {
  readonly id: QuestionId;
  readonly canonicalText: string;
  readonly normalizedText: string;
  readonly category: QuestionCategory;
  /** Cases this question has been observed in. Scopes step 3. */
  readonly caseIds: readonly CaseId[];
}

export interface DeduplicatorOptions {
  readonly thresholds?: DedupThresholds;
  readonly weights?: SimilarityWeights;
  readonly lexicon?: Lexicon;
  /** Number of MinHash permutations. Higher = more accurate blocking, more CPU. */
  readonly numHashes?: number;
  readonly lshBands?: number;
  /** Compute IDF from the indexed corpus. Default true. */
  readonly useCorpusIdf?: boolean;
}

/**
 * Deduplicator over one snapshot of published questions.
 *
 * Built per batch, not held as service state. Constructing the index is O(N)
 * and a full pass over 20k questions takes single-digit milliseconds; holding
 * it across requests would trade that for a stale-cache correctness bug.
 */
export class QuestionDeduplicator {
  private readonly thresholds: DedupThresholds;
  private readonly weights: SimilarityWeights;
  private readonly lexicon: Lexicon;
  private readonly hasher: MinHasher;
  private readonly lshBands: number;

  private readonly byNormalized = new Map<string, QuestionRecord>();
  private readonly lsh = new LshIndex<QuestionRecord>();
  private readonly conceptIndex = new Map<string, QuestionRecord[]>();
  private readonly tokensById = new Map<string, readonly string[]>();
  private readonly conceptsById = new Map<string, ReadonlySet<string>>();
  private idf: IdfFunction = UNIFORM_IDF;

  constructor(questions: readonly QuestionRecord[], options: DeduplicatorOptions = {}) {
    this.thresholds = options.thresholds ?? DEFAULT_DEDUP_THRESHOLDS;
    this.weights = options.weights ?? DEFAULT_SIMILARITY_WEIGHTS;
    this.lexicon = options.lexicon ?? defaultLexicon;
    this.hasher = new MinHasher(options.numHashes ?? 64);
    this.lshBands = options.lshBands ?? 16;

    const corpus: string[][] = [];

    for (const question of questions) {
      const key = question.normalizedText;
      if (!this.byNormalized.has(key)) this.byNormalized.set(key, question);

      const tokens = tokenize(question.canonicalText);
      this.tokensById.set(question.id as string, tokens);
      corpus.push(tokens);

      const signature = this.hasher.signature(tokens);
      this.lsh.add(this.hasher.bandKeys(signature, this.lshBands), question);

      const concepts = this.lexicon.conceptsIn(tokens);
      this.conceptsById.set(question.id as string, concepts);
      for (const conceptId of concepts) {
        const bucket = this.conceptIndex.get(conceptId);
        if (bucket === undefined) this.conceptIndex.set(conceptId, [question]);
        else bucket.push(question);
      }
    }

    if ((options.useCorpusIdf ?? true) && corpus.length > 0) {
      this.idf = buildIdf(corpus);
    }
  }

  /**
   * Runs steps 2-6 for one incoming question.
   *
   * `caseId` scopes the concept-set step: two questions naming the same
   * concepts are far more likely to be the same question when they were
   * observed in the same clinical case. Passing null widens the search.
   */
  findDuplicates(
    questionText: string,
    caseId: CaseId | null = null,
    category: QuestionCategory | null = null,
  ): DedupResult {
    const normalized = normalizeForMatching(questionText);
    const tokens = tokenize(questionText);
    const concepts = this.lexicon.conceptsIn(tokens);

    // --- Step 2: exact normalized match ------------------------------------
    const exact = this.byNormalized.get(normalized);
    if (exact !== undefined) {
      return {
        best: {
          questionId: exact.id,
          canonicalText: exact.canonicalText,
          kind: 'EXACT',
          lexicalScore: 1,
          conceptScore: concepts.size === 0 ? null : 1,
          sharedConcepts: [...concepts],
          matchedBy: 'exact-normalized',
        },
        matches: [],
        comparisons: 0,
      };
    }

    // --- Candidate generation: LSH bands, plus concept co-occurrence --------
    const signature = this.hasher.signature(tokens);
    const candidates = new Map<string, QuestionRecord>();
    for (const record of this.lsh.query(this.hasher.bandKeys(signature, this.lshBands))) {
      candidates.set(record.id as string, record);
    }
    for (const conceptId of concepts) {
      for (const record of this.conceptIndex.get(conceptId) ?? []) {
        candidates.set(record.id as string, record);
      }
    }

    // --- Steps 3-5: score each candidate ------------------------------------
    const matches: DedupCandidateMatch[] = [];
    let comparisons = 0;

    for (const record of candidates.values()) {
      comparisons++;
      const otherTokens = this.tokensById.get(record.id as string) ?? tokenize(record.canonicalText);
      const otherConcepts = this.conceptsById.get(record.id as string) ?? new Set<string>();

      const lexicalScore = compositeSimilarity(
        normalized,
        record.normalizedText,
        tokens,
        otherTokens,
        this.weights,
        this.idf,
      );

      const bothHaveConcepts = concepts.size > 0 && otherConcepts.size > 0;
      const conceptScore = bothHaveConcepts ? jaccard(concepts, otherConcepts) : null;
      const shared = bothHaveConcepts
        ? [...concepts].filter((c) => otherConcepts.has(c))
        : [];

      // Step 3/5: concept agreement can promote a pair that lexical similarity
      // alone would miss - the cross-language case, where the two texts share no
      // characters at all and every lexical metric is structurally 0.
      //
      // Three guards keep that from over-firing, because concept sets are a much
      // coarser signal than text:
      //
      //   same case      - identical concepts observed in different clinical
      //                    cases are usually different questions;
      //   same category  - "complications of DVT" and "investigations for DVT"
      //                    name the same concept and ask opposite things. The
      //                    interrogative category is what separates them, and it
      //                    is already computed at extraction time;
      //   enough shared  - a single shared concept scores Jaccard 1.0 while
      //                    carrying no evidence at all.
      const sameCase = caseId === null || record.caseIds.includes(caseId);
      const sameCategory =
        category === null || record.category === 'UNCLASSIFIED' || category === record.category;
      const conceptPromoted =
        conceptScore !== null &&
        conceptScore >= this.thresholds.conceptStrong &&
        shared.length >= this.thresholds.minSharedConcepts &&
        sameCase &&
        sameCategory;

      let kind: DedupDecisionKind;
      let matchedBy: DedupCandidateMatch['matchedBy'] = 'lexical-similarity';

      if (lexicalScore >= this.thresholds.strong) {
        kind = 'STRONG_SUGGESTION';
      } else if (conceptPromoted) {
        kind = 'STRONG_SUGGESTION';
        matchedBy = 'concept-set';
      } else if (lexicalScore >= this.thresholds.weak) {
        kind = 'WEAK_SUGGESTION';
      } else {
        kind = 'DISTINCT';
      }

      if (kind === 'DISTINCT') continue;

      matches.push({
        questionId: record.id,
        canonicalText: record.canonicalText,
        kind,
        lexicalScore,
        conceptScore,
        sharedConcepts: shared,
        matchedBy,
      });
    }

    matches.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'STRONG_SUGGESTION' ? -1 : 1;
      return b.lexicalScore - a.lexicalScore;
    });

    return { best: matches[0] ?? null, matches, comparisons };
  }

  /** Diagnostics for tuning blocking recall against comparison cost. */
  get stats(): { questions: number; lshBuckets: number; conceptBuckets: number } {
    return {
      questions: this.byNormalized.size,
      lshBuckets: this.lsh.bucketCount,
      conceptBuckets: this.conceptIndex.size,
    };
  }
}

/**
 * Canonical text selection when a reviewer merges variants.
 *
 * Picks the longest complete-looking wording, preferring one that ends with a
 * question mark and does not begin mid-sentence. Rationale: the canonical text
 * is what a student sees, and the most complete observed phrasing is the most
 * useful of the observed phrasings. Every rejected wording survives as a
 * `QuestionVariant`, so nothing is lost.
 */
export function chooseCanonicalText(variants: readonly string[]): string {
  if (variants.length === 0) return '';
  const scored = variants.map((text) => {
    const trimmed = text.trim();
    let score = Math.min(trimmed.length, 200) / 200;
    if (/[?؟]\s*$/u.test(trimmed)) score += 0.3;
    if (/^[a-z؀-ۿ]/u.test(trimmed)) score -= 0.1; // starts lowercase
    if (/^(and|or|but|و|أو)\b/iu.test(trimmed)) score -= 0.3; // fragment
    return { text: trimmed, score };
  });
  scored.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return (scored[0] as { text: string }).text;
}

/** Convenience for building a `QuestionRecord` from a `Question`. */
export function toRecord(question: Question, caseIds: readonly CaseId[] = []): QuestionRecord {
  return {
    id: question.id,
    canonicalText: question.canonicalText,
    normalizedText: question.normalizedText,
    category: question.category,
    caseIds,
  };
}
