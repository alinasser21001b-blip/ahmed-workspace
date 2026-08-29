/**
 * Station compiler: published knowledge -> one reproducible OSCE attempt.
 *
 * Implements Section 7, including its "professional improvement" note: every
 * station is deterministic given its seed, so it can be replayed exactly.
 *
 * Two invariants are enforced structurally rather than by comment, because they
 * are the ones whose violation is invisible from the outside:
 *
 *   1. Every question in the compiled station is reachable through a published
 *      examiner -> published case -> published question chain. Unpublished
 *      knowledge cannot enter, because the repository port only exposes
 *      published rows and the compiler re-validates the chain anyway.
 *
 *   2. Question order is frozen at creation. The compiler emits an ordered
 *      list; the session persists it; nothing recomputes it later. A refresh
 *      mid-station therefore cannot produce a different station.
 *
 * Performance: this runs on the exam-start critical path, with an 800 ms p95
 * budget for the whole endpoint. The compiler itself is O(P log P) in the
 * candidate question pool with no I/O of its own - all reads happen through the
 * repository before it is called, so the cost here is arithmetic on data
 * already in memory.
 */

import type {
  CaseId,
  ExaminerId,
  QuestionCategory,
  QuestionId,
  SelectionReason,
  SpecialtyId,
} from '../domain/types.ts';
import { EngineError } from '../domain/errors.ts';
import { SeededRandom } from './rng.ts';

export type ExaminerMode = 'RANDOM' | 'SELECTED';

/** A published examiner as the compiler needs to see it. */
export interface CompilerExaminer {
  readonly id: ExaminerId;
  readonly specialtyId: SpecialtyId;
  readonly canonicalName: string;
  /** Total approved observations across all this examiner's cases. */
  readonly observationCount: number;
}

export interface CompilerCase {
  readonly id: CaseId;
  readonly examinerId: ExaminerId;
  readonly title: string;
  readonly observationCount: number;
  readonly lastSeenYear: number | null;
}

export interface CompilerQuestion {
  readonly id: QuestionId;
  readonly examinerId: ExaminerId;
  readonly caseId: CaseId;
  readonly canonicalText: string;
  readonly category: QuestionCategory;
  /** Approved occurrences of this question for this examiner+case. */
  readonly observationCount: number;
  readonly lastSeenYear: number | null;
  /** True when an approved ExpectedAnswer with key points exists. */
  readonly evaluationReady: boolean;
}

/**
 * Ranking policy. Weights match Section 7's recommended score and are
 * configurable, because the framework is explicit that this is "a ranking
 * heuristic, not a medical truth score".
 */
export interface StationPolicy {
  readonly version: string;
  readonly weightHistoricalFrequency: number;
  readonly weightCaseRelevance: number;
  readonly weightRecency: number;
  readonly weightCategoryDiversity: number;
  readonly weightRandomness: number;
  /** Years after which the recency signal has decayed to ~0.37. */
  readonly recencyHalfLifeYears: number;
  /** Max questions of one category before the diversity bonus goes negative. */
  readonly maxPerCategory: number;
  /** Prefer questions that can be auto-evaluated, without excluding others. */
  readonly evaluationReadyBonus: number;
}

export const DEFAULT_POLICY: StationPolicy = Object.freeze({
  version: 'policy-2.0.0',
  weightHistoricalFrequency: 0.45,
  weightCaseRelevance: 0.25,
  weightRecency: 0.15,
  weightCategoryDiversity: 0.1,
  weightRandomness: 0.05,
  recencyHalfLifeYears: 3,
  maxPerCategory: 2,
  evaluationReadyBonus: 0.05,
});

export interface CompileInput {
  readonly specialtyId: SpecialtyId;
  readonly examinerMode: ExaminerMode;
  readonly examinerId?: ExaminerId;
  readonly preparationSeconds: number;
  readonly desiredQuestionCount: number;
  /** Seed making this compilation reproducible. */
  readonly seed: string;
  /** Current year, for the recency signal. Injected, never read from a clock. */
  readonly currentYear: number;
  readonly policy?: StationPolicy;
  /** Minimum questions below which compilation fails rather than under-delivers. */
  readonly minQuestionCount?: number;
}

export interface CompiledQuestion {
  readonly questionId: QuestionId;
  readonly canonicalText: string;
  readonly category: QuestionCategory;
  readonly order: number;
  readonly evaluationReady: boolean;
  readonly selectionReason: SelectionReason;
}

export interface CompiledStation {
  readonly examinerId: ExaminerId;
  readonly examinerName: string;
  readonly caseId: CaseId;
  readonly caseTitle: string;
  readonly specialtyId: SpecialtyId;
  readonly questions: readonly CompiledQuestion[];
  readonly seed: string;
  readonly policyVersion: string;
  readonly preparationSeconds: number;
  /** Counts describing what the compiler had to work with. */
  readonly diagnostics: {
    readonly examinerPoolSize: number;
    readonly casePoolSize: number;
    readonly questionPoolSize: number;
    readonly evaluationReadyCount: number;
  };
}

/** Read port. The compiler never touches a database directly. */
export interface KnowledgeSource {
  listPublishedExaminers(specialtyId: SpecialtyId): readonly CompilerExaminer[];
  listPublishedCasesForExaminer(examinerId: ExaminerId): readonly CompilerCase[];
  listPublishedQuestions(examinerId: ExaminerId, caseId: CaseId): readonly CompilerQuestion[];
}

export function compileStation(input: CompileInput, source: KnowledgeSource): CompiledStation {
  const policy = input.policy ?? DEFAULT_POLICY;
  const rng = new SeededRandom(input.seed);
  const minCount = input.minQuestionCount ?? 1;

  // --- Examiner selection ---------------------------------------------------
  const examiners = source.listPublishedExaminers(input.specialtyId);
  if (examiners.length === 0) {
    throw new EngineError(
      'NO_PUBLISHED_EXAMINER',
      `No published examiner exists for specialty ${input.specialtyId}`,
      { specialtyId: input.specialtyId },
    );
  }

  let examiner: CompilerExaminer;
  if (input.examinerMode === 'SELECTED') {
    if (input.examinerId === undefined) {
      throw new EngineError(
        'EXAMINER_SPECIALTY_MISMATCH',
        'examinerMode SELECTED requires an examinerId',
        { specialtyId: input.specialtyId },
      );
    }
    const chosen = examiners.find((e) => e.id === input.examinerId);
    if (chosen === undefined) {
      // Either the examiner does not exist, is unpublished, or belongs to
      // another specialty. All three are the same error from the caller's
      // perspective and none may be silently substituted.
      throw new EngineError(
        'EXAMINER_SPECIALTY_MISMATCH',
        'Selected examiner is not a published examiner of this specialty',
        { specialtyId: input.specialtyId, examinerId: input.examinerId },
      );
    }
    examiner = chosen;
  } else {
    // Weighted by observation count so examiners with more historical evidence
    // appear more often, with a floor so a sparsely-recorded examiner is still
    // reachable.
    const weights = examiners.map((e) => 1 + Math.log1p(Math.max(0, e.observationCount)));
    examiner = rng.weightedPick(examiners, weights);
  }

  // --- Case selection -------------------------------------------------------
  const cases = source.listPublishedCasesForExaminer(examiner.id);
  if (cases.length === 0) {
    throw new EngineError(
      'NO_PUBLISHED_CASE',
      `Examiner ${examiner.id} has no published case`,
      { examinerId: examiner.id, specialtyId: input.specialtyId },
    );
  }
  const caseWeights = cases.map((c) => 1 + Math.log1p(Math.max(0, c.observationCount)));
  const clinicalCase = rng.weightedPick(cases, caseWeights);

  // Invariant re-check: the case must belong to the selected examiner. The
  // repository should guarantee this; the compiler asserts it anyway, because a
  // cross-linked row here produces a station that looks valid and is not.
  if (clinicalCase.examinerId !== examiner.id) {
    throw new EngineError(
      'CASE_NOT_LINKED_TO_EXAMINER',
      'Selected case is not linked to the selected examiner',
      { examinerId: examiner.id, caseId: clinicalCase.id },
    );
  }

  // --- Question pool --------------------------------------------------------
  const pool = source
    .listPublishedQuestions(examiner.id, clinicalCase.id)
    .filter((q) => q.examinerId === examiner.id && q.caseId === clinicalCase.id);

  if (pool.length < minCount) {
    throw new EngineError(
      'INSUFFICIENT_QUESTIONS',
      `Only ${pool.length} published questions available; ${minCount} required`,
      {
        examinerId: examiner.id,
        caseId: clinicalCase.id,
        available: pool.length,
        required: minCount,
      },
    );
  }

  const selected = rankAndSelect(pool, input, policy, rng, clinicalCase);

  return {
    examinerId: examiner.id,
    examinerName: examiner.canonicalName,
    caseId: clinicalCase.id,
    caseTitle: clinicalCase.title,
    specialtyId: input.specialtyId,
    questions: selected,
    seed: input.seed,
    policyVersion: policy.version,
    preparationSeconds: input.preparationSeconds,
    diagnostics: {
      examinerPoolSize: examiners.length,
      casePoolSize: cases.length,
      questionPoolSize: pool.length,
      evaluationReadyCount: selected.filter((q) => q.evaluationReady).length,
    },
  };
}

/**
 * Ranks the pool and selects with category diversification.
 *
 * Selection is greedy over the ranked list with a diversity penalty recomputed
 * after each pick, rather than a single sort. A pure sort would happily return
 * five MANAGEMENT questions when management questions happen to be the most
 * frequently observed - technically the highest-scoring station, and a poor
 * examination.
 */
function rankAndSelect(
  pool: readonly CompilerQuestion[],
  input: CompileInput,
  policy: StationPolicy,
  rng: SeededRandom,
  clinicalCase: CompilerCase,
): CompiledQuestion[] {
  const maxObservations = Math.max(1, ...pool.map((q) => q.observationCount));
  const caseObservations = Math.max(1, clinicalCase.observationCount);

  // Randomness is drawn once per question, before selection, so the ordering of
  // the greedy loop cannot change how many draws each question receives. This
  // is what makes the whole compilation reproducible from the seed.
  const randomness = new Map<string, number>();
  for (const question of pool) randomness.set(question.id as string, rng.next());

  const base = pool.map((question) => {
    const historicalFrequency = question.observationCount / maxObservations;
    // How much of this case's evidence this question accounts for.
    const caseRelevance = Math.min(1, question.observationCount / caseObservations);
    const recencySignal =
      question.lastSeenYear === null
        ? 0
        : Math.exp(
            (-Math.LN2 * Math.max(0, input.currentYear - question.lastSeenYear)) /
              policy.recencyHalfLifeYears,
          );
    return {
      question,
      historicalFrequency,
      caseRelevance,
      recencySignal,
      randomness: randomness.get(question.id as string) as number,
    };
  });

  const chosen: CompiledQuestion[] = [];
  const categoryCounts = new Map<QuestionCategory, number>();
  const remaining = [...base];
  const target = Math.min(input.desiredQuestionCount, pool.length);

  while (chosen.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    let bestDiversity = 0;

    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i] as (typeof remaining)[number];
      const used = categoryCounts.get(entry.question.category) ?? 0;
      // Full bonus for an unused category, decaying to a penalty past the cap.
      const diversityBonus = used === 0 ? 1 : Math.max(-1, 1 - used / policy.maxPerCategory);

      const score =
        policy.weightHistoricalFrequency * entry.historicalFrequency +
        policy.weightCaseRelevance * entry.caseRelevance +
        policy.weightRecency * entry.recencySignal +
        policy.weightCategoryDiversity * diversityBonus +
        policy.weightRandomness * entry.randomness +
        (entry.question.evaluationReady ? policy.evaluationReadyBonus : 0);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
        bestDiversity = diversityBonus;
      }
    }

    const winner = remaining.splice(bestIndex, 1)[0] as (typeof base)[number];
    categoryCounts.set(
      winner.question.category,
      (categoryCounts.get(winner.question.category) ?? 0) + 1,
    );

    chosen.push({
      questionId: winner.question.id,
      canonicalText: winner.question.canonicalText,
      category: winner.question.category,
      order: chosen.length + 1,
      evaluationReady: winner.question.evaluationReady,
      // Every component is recorded. Section 12's P1 asks for "structured
      // selection-reason logging"; storing the reason on the row makes it
      // queryable rather than only greppable in logs.
      selectionReason: {
        score: round4(bestScore),
        historicalFrequency: round4(winner.historicalFrequency),
        caseRelevance: round4(winner.caseRelevance),
        recencySignal: round4(winner.recencySignal),
        diversityBonus: round4(bestDiversity),
        randomness: round4(winner.randomness),
        rank: chosen.length + 1,
        poolSize: pool.length,
      },
    });
  }

  return chosen;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
