/**
 * Examiner identity resolution.
 *
 * The framework is unambiguous about the stakes here: "Do not silently merge
 * 'Dr Ahmed Hassan' and 'Dr Ahmed Hussein' because a fuzzy matcher thinks the
 * names are close", and the KPI table tolerates zero incorrect auto-merges.
 *
 * The design that satisfies that is a two-gate one, and the distinction matters:
 *
 *   Gate 1 - EVIDENCE. Fellegi-Sunter produces a posterior probability with a
 *            per-field breakdown. This gate is statistical and tunable.
 *
 *   Gate 2 - AUTHORITY. Regardless of how high the posterior is, an automatic
 *            match is permitted ONLY when the observed name is exactly equal to
 *            a canonical name or a registered alias after normalization.
 *            Everything else is a suggestion for a human.
 *
 * Gate 2 is what makes the zero-tolerance KPI achievable. Any purely
 * probabilistic system has a nonzero false-merge rate by construction; adding a
 * deterministic authority gate makes the automatic path exact and routes all
 * genuine uncertainty to review. The probability is then used for what it is
 * good at - ranking the review queue and explaining the suggestion - rather
 * than for taking an irreversible action.
 */

import type { Examiner, ExaminerId, SpecialtyId } from '../domain/types.ts';
import { normalizeForMatching } from '../text/normalize.ts';
import { splitWords } from '../text/tokenize.ts';
import { blockingKeys, stripTitles } from '../text/phonetic.ts';
import { jaroWinkler, diceCoefficient } from '../text/similarity.ts';
import {
  DEFAULT_THRESHOLDS,
  decide,
  scorePair,
  type ComparisonField,
  type DecisionThresholds,
  type MatchScore,
} from './fellegi-sunter.ts';

/** A name prepared for comparison. Computed once per candidate, reused per pair. */
export interface NameProfile {
  readonly raw: string;
  readonly normalized: string;
  /** Title words removed; this is what gets compared. */
  readonly tokens: readonly string[];
  readonly surname: string;
  readonly given: string;
  readonly blockKeys: readonly string[];
}

export function profileName(raw: string): NameProfile {
  const normalized = normalizeForMatching(raw);
  const tokens = stripTitles(splitWords(normalized));
  return {
    raw,
    normalized,
    tokens,
    given: tokens[0] ?? '',
    surname: tokens.length > 1 ? (tokens[tokens.length - 1] as string) : '',
    blockKeys: blockingKeys(splitWords(normalized)),
  };
}

/**
 * Comparison fields for examiner names.
 *
 * m/u values are informed priors. Reading the surname field: two records of the
 * same examiner have identical surnames about 85% of the time (the rest being
 * typos and transliteration drift), while two *different* examiners sharing a
 * phonetic block have identical surnames about 8% of the time. The resulting
 * log Bayes factor is log2(0.85/0.08) = +3.4 bits for agreement.
 */
export const EXAMINER_FIELDS: readonly ComparisonField<NameProfile>[] = [
  {
    name: 'surname',
    compare: (a, b) => {
      if (a.surname === '' || b.surname === '') return 0;
      if (a.surname === b.surname) return 3;
      const jw = jaroWinkler(a.surname, b.surname);
      if (jw >= 0.94) return 2;
      if (jw >= 0.85) return 1;
      return 0;
    },
    levels: [
      { name: 'different', m: 0.03, u: 0.86 },
      { name: 'similar', m: 0.05, u: 0.04 },
      { name: 'near-identical', m: 0.07, u: 0.02 },
      { name: 'exact', m: 0.85, u: 0.08 },
    ],
  },
  {
    name: 'given',
    compare: (a, b) => {
      if (a.given === '' || b.given === '') return 0;
      if (a.given === b.given) return 3;
      const jw = jaroWinkler(a.given, b.given);
      if (jw >= 0.94) return 2;
      if (jw >= 0.85) return 1;
      return 0;
    },
    levels: [
      { name: 'different', m: 0.05, u: 0.8 },
      { name: 'similar', m: 0.07, u: 0.07 },
      { name: 'near-identical', m: 0.08, u: 0.03 },
      { name: 'exact', m: 0.8, u: 0.1 },
    ],
  },
  {
    name: 'full-name',
    compare: (a, b) => {
      const aJoined = a.tokens.join(' ');
      const bJoined = b.tokens.join(' ');
      if (aJoined === '' || bJoined === '') return 0;
      if (aJoined === bJoined) return 3;
      const dice = diceCoefficient(aJoined, bJoined, 3);
      if (dice >= 0.85) return 2;
      if (dice >= 0.6) return 1;
      return 0;
    },
    levels: [
      { name: 'different', m: 0.02, u: 0.9 },
      { name: 'similar', m: 0.13, u: 0.07 },
      { name: 'near-identical', m: 0.15, u: 0.02 },
      { name: 'exact', m: 0.7, u: 0.01 },
    ],
    // Correlated with surname and given; damped so it cannot dominate the sum.
    weight: 0.6,
  },
  {
    name: 'token-count',
    compare: (a, b) => (a.tokens.length === b.tokens.length ? 1 : 0),
    levels: [
      { name: 'different', m: 0.25, u: 0.55 },
      { name: 'same', m: 0.75, u: 0.45 },
    ],
    weight: 0.4,
  },
];

export type ExaminerResolution =
  | {
      readonly kind: 'MATCHED';
      readonly examinerId: ExaminerId;
      readonly confidence: number;
      readonly reason: 'EXACT_CANONICAL' | 'EXACT_ALIAS';
      readonly score: MatchScore | null;
    }
  | {
      readonly kind: 'NEW_CANDIDATE';
      readonly suggestedCanonicalName: string;
      readonly confidence: number;
      /** Best rejected candidate, if any, so the reviewer sees the near miss. */
      readonly nearest: { readonly examinerId: ExaminerId; readonly probability: number } | null;
    }
  | {
      readonly kind: 'AMBIGUOUS';
      readonly alternatives: readonly {
        readonly examinerId: ExaminerId;
        readonly canonicalName: string;
        readonly probability: number;
        readonly score: MatchScore;
      }[];
      readonly confidence: number;
    };

export interface ExaminerResolverOptions {
  readonly thresholds?: DecisionThresholds;
  readonly prior?: number;
  /** Max alternatives reported on AMBIGUOUS. Default 5. */
  readonly maxAlternatives?: number;
}

/**
 * Resolves an observed examiner name within one specialty.
 *
 * Candidates are restricted to the given specialty. Cross-specialty merging is
 * never proposed: two doctors with the same name in different departments are
 * far more likely to be two people than one person examining in both, and the
 * cost of being wrong is corrupting the core historical asset.
 */
export class ExaminerResolver {
  private readonly thresholds: DecisionThresholds;
  private readonly prior: number;
  private readonly maxAlternatives: number;

  constructor(options: ExaminerResolverOptions = {}) {
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    this.prior = options.prior ?? 0.1;
    this.maxAlternatives = options.maxAlternatives ?? 5;
  }

  /**
   * Builds the blocking index once per resolution batch.
   *
   * Returned rather than stored so the caller controls its lifetime: on a
   * Worker the index is rebuilt per request from a query, and holding it on the
   * resolver would be exactly the "correctness-critical in-memory state" the
   * framework's reliability table warns against.
   */
  static buildIndex(examiners: readonly Examiner[]): ExaminerIndex {
    return new ExaminerIndex(examiners);
  }

  resolve(
    observedName: string,
    specialtyId: SpecialtyId,
    index: ExaminerIndex,
  ): ExaminerResolution {
    const profile = profileName(observedName);

    // --- Gate 2 first: an exact canonical or alias hit is authoritative -----
    const exact = index.findExact(profile.normalized, specialtyId);
    if (exact !== null) {
      return {
        kind: 'MATCHED',
        examinerId: exact.examiner.id,
        confidence: 1,
        reason: exact.viaAlias ? 'EXACT_ALIAS' : 'EXACT_CANONICAL',
        score: null,
      };
    }

    // --- Gate 1: score the blocked candidates -------------------------------
    const candidates = index.candidatesFor(profile, specialtyId);
    const scored = candidates
      .map((examiner) => {
        const score = scorePair(profile, index.profileOf(examiner), EXAMINER_FIELDS, this.prior);
        return { examiner, score };
      })
      .sort((a, b) => b.score.probability - a.score.probability);

    if (scored.length === 0) {
      return {
        kind: 'NEW_CANDIDATE',
        suggestedCanonicalName: suggestCanonicalName(observedName),
        confidence: 1,
        nearest: null,
      };
    }

    // Anything the evidence gate calls MATCH or AMBIGUOUS goes to a human,
    // because Gate 2 did not fire. This is the whole safety property.
    const contenders = scored.filter((s) => decide(s.score, this.thresholds) !== 'NO_MATCH');

    if (contenders.length === 0) {
      const best = scored[0] as (typeof scored)[number];
      return {
        kind: 'NEW_CANDIDATE',
        suggestedCanonicalName: suggestCanonicalName(observedName),
        confidence: 1 - best.score.probability,
        nearest: { examinerId: best.examiner.id, probability: best.score.probability },
      };
    }

    return {
      kind: 'AMBIGUOUS',
      alternatives: contenders.slice(0, this.maxAlternatives).map((c) => ({
        examinerId: c.examiner.id,
        canonicalName: c.examiner.canonicalName,
        probability: c.score.probability,
        score: c.score,
      })),
      confidence: (contenders[0] as (typeof contenders)[number]).score.probability,
    };
  }
}

/** Blocking index over one snapshot of examiners. */
export class ExaminerIndex {
  private readonly byBlockKey = new Map<string, Examiner[]>();
  private readonly byExactName = new Map<string, { examiner: Examiner; viaAlias: boolean }>();
  private readonly profiles = new Map<string, NameProfile>();

  constructor(examiners: readonly Examiner[]) {
    for (const examiner of examiners) {
      if (!examiner.active) continue;
      const profile = profileName(examiner.canonicalName);
      this.profiles.set(examiner.id as string, profile);

      const canonicalKey = exactKey(profile.normalized, examiner.specialtyId);
      if (!this.byExactName.has(canonicalKey)) {
        this.byExactName.set(canonicalKey, { examiner, viaAlias: false });
      }
      for (const alias of examiner.aliases) {
        const aliasKey = exactKey(normalizeForMatching(alias), examiner.specialtyId);
        if (!this.byExactName.has(aliasKey)) {
          this.byExactName.set(aliasKey, { examiner, viaAlias: true });
        }
      }
      for (const key of profile.blockKeys) {
        const scoped = `${examiner.specialtyId}|${key}`;
        const bucket = this.byBlockKey.get(scoped);
        if (bucket === undefined) this.byBlockKey.set(scoped, [examiner]);
        else bucket.push(examiner);
      }
    }
  }

  findExact(
    normalizedName: string,
    specialtyId: SpecialtyId,
  ): { examiner: Examiner; viaAlias: boolean } | null {
    return this.byExactName.get(exactKey(normalizedName, specialtyId)) ?? null;
  }

  candidatesFor(profile: NameProfile, specialtyId: SpecialtyId): Examiner[] {
    const seen = new Map<string, Examiner>();
    for (const key of profile.blockKeys) {
      const bucket = this.byBlockKey.get(`${specialtyId}|${key}`);
      if (bucket === undefined) continue;
      for (const examiner of bucket) seen.set(examiner.id as string, examiner);
    }
    return [...seen.values()];
  }

  profileOf(examiner: Examiner): NameProfile {
    const cached = this.profiles.get(examiner.id as string);
    if (cached !== undefined) return cached;
    const profile = profileName(examiner.canonicalName);
    this.profiles.set(examiner.id as string, profile);
    return profile;
  }

  /** Diagnostics: bucket size distribution, for tuning blocking. */
  get stats(): { buckets: number; maxBucket: number; meanBucket: number } {
    const sizes = [...this.byBlockKey.values()].map((b) => b.length);
    return {
      buckets: sizes.length,
      maxBucket: sizes.length === 0 ? 0 : Math.max(...sizes),
      meanBucket: sizes.length === 0 ? 0 : sizes.reduce((a, b) => a + b, 0) / sizes.length,
    };
  }
}

function exactKey(normalizedName: string, specialtyId: SpecialtyId): string {
  return `${specialtyId}|${normalizedName}`;
}

/**
 * Proposes a canonical spelling for a newly seen examiner.
 *
 * Title-cases each word and keeps a single leading "Dr." if one was present.
 * Deliberately minimal: a canonical name is a human decision, and this is only
 * the pre-filled value in the review form.
 */
export function suggestCanonicalName(observedName: string): string {
  const hadTitle = /^\s*(dr|doctor|prof|professor|د|دكتور|الدكتور)\b/iu.test(observedName);
  const words = stripTitles(splitWords(normalizeForMatching(observedName)));
  const titled = words
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
  return hadTitle ? `Dr. ${titled}` : titled;
}
