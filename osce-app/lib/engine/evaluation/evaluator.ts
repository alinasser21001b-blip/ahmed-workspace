/**
 * Grounded answer evaluation (Sections 9 and 11).
 *
 * "Evaluation is comparison, not question answering." Everything in this module
 * follows from that sentence. The evaluator never decides what is medically
 * true; it decides how much of an approved answer key a student's response
 * covered. The medical judgement was made by a reviewer at curation time and is
 * stored in the key points.
 *
 * That framing is what makes an LLM unnecessary here, and it is worth being
 * precise about the trade rather than hand-waving it.
 *
 * What this evaluator does that naive string matching cannot:
 *   - matches "DVT" to "deep vein thrombosis" through the controlled vocabulary
 *   - matches Arabic answers to English key points, and vice versa
 *   - refuses to credit a negated mention ("no evidence of DVT")
 *   - discounts a hedged mention ("possibly DVT") rather than crediting it fully
 *   - awards partial credit for a broader-but-true answer ("thrombosis" for a
 *     "DVT" key point) via the concept hierarchy
 *   - understands numeric answers with tolerance and unit awareness
 *   - penalises pitfall points - the "never say this" traps in OSCE marking
 *
 * What it cannot do, stated plainly: recognise a paraphrase that uses no listed
 * surface form and names no known concept. Those land in `unmatchedTerms`,
 * which is a work queue for the reviewer, not a silent failure. Recall is
 * therefore bounded by vocabulary coverage and grows with it - a property an
 * embedding model does not have, since its blind spots cannot be enumerated or
 * fixed by editing a table.
 *
 * Latency budget is 300 ms p95 for the whole endpoint (Section 10). The
 * matching below is O(keyPoints x answerTokens) with small constants and runs
 * in tens of microseconds, leaving the budget to I/O where it belongs.
 */

import type { Correctness, KeyPoint } from '../domain/types';
import { tokenize } from '../text/tokenize';
import {
  annotateContextDetailed,
  externalSpanContext,
  type ContextKind,
  type TokenContext,
} from '../text/negation';
import { Lexicon, defaultLexicon } from '../text/lexicon';
import { diceCoefficient, containment, levenshtein } from '../text/similarity';

export const EVALUATOR_VERSION = 'deterministic-2.0.0';

export interface EvaluationInput {
  readonly question: string;
  readonly referenceAnswer: string;
  readonly keyPoints: readonly KeyPoint[];
  readonly studentAnswer: string;
}

export type PointStatus = 'COVERED' | 'PARTIAL' | 'NEGATED' | 'HEDGED' | 'MISSING';

export interface PointOutcome {
  readonly pointId: string;
  readonly text: string;
  readonly status: PointStatus;
  /** Credit awarded for this point, 0..1, before weighting. */
  readonly credit: number;
  /** How the match was made. Shown to the student when explaining a mark. */
  readonly matchedVia: 'exact' | 'synonym' | 'concept' | 'broader-concept' | 'fuzzy' | null;
  /** The span of the student's answer that matched. */
  readonly matchedText: string | null;
}

export interface EvaluationResult {
  readonly correctness: Correctness;
  /** Weighted coverage, 0..1. */
  readonly score: number;
  readonly coveredPoints: readonly string[];
  readonly missingPoints: readonly string[];
  readonly triggeredPitfalls: readonly string[];
  readonly outcomes: readonly PointOutcome[];
  /**
   * Content words in the student's answer that matched no key point and no
   * known concept. The reviewer feedback loop: recurring entries here are
   * either missing vocabulary or a missing key point.
   */
  readonly unmatchedTerms: readonly string[];
  readonly feedback: string;
  /** How confident the evaluator is in its own verdict, 0..1. */
  readonly confidence: number;
  readonly evaluatorVersion: string;
}

export interface EvaluatorOptions {
  readonly lexicon?: Lexicon;
  /** Fuzzy match threshold for a key point phrase against an answer window. */
  readonly fuzzyThreshold?: number;
  /** Credit multiplier for a hedged mention. Default 0.5. */
  readonly hedgeCredit?: number;
  /** Credit multiplier for a broader-concept match. Default 0.5. */
  readonly broaderCredit?: number;
  /** Weighted coverage at or above which the answer is CORRECT. Default 0.999. */
  readonly correctThreshold?: number;
  /** Penalty subtracted from the score per triggered pitfall. Default 0.25. */
  readonly pitfallPenalty?: number;
}

const DEFAULTS = {
  fuzzyThreshold: 0.82,
  hedgeCredit: 0.5,
  broaderCredit: 0.5,
  correctThreshold: 0.999,
  pitfallPenalty: 0.25,
} as const;

/** One key point compiled into all the forms it can be matched by. */
interface CompiledPoint {
  readonly point: KeyPoint;
  /** Normalized surface forms: the point text plus reviewer synonyms. */
  readonly forms: readonly { tokens: readonly string[]; text: string }[];
  /** Concepts the point names. */
  readonly concepts: ReadonlySet<string>;
}

export class DeterministicEvaluator {
  private readonly lexicon: Lexicon;
  private readonly options: Required<Omit<EvaluatorOptions, 'lexicon'>>;

  constructor(options: EvaluatorOptions = {}) {
    this.lexicon = options.lexicon ?? defaultLexicon;
    this.options = {
      fuzzyThreshold: options.fuzzyThreshold ?? DEFAULTS.fuzzyThreshold,
      hedgeCredit: options.hedgeCredit ?? DEFAULTS.hedgeCredit,
      broaderCredit: options.broaderCredit ?? DEFAULTS.broaderCredit,
      correctThreshold: options.correctThreshold ?? DEFAULTS.correctThreshold,
      pitfallPenalty: options.pitfallPenalty ?? DEFAULTS.pitfallPenalty,
    };
  }

  evaluate(input: EvaluationInput): EvaluationResult {
    // Stop words are kept: "no fever" must not become "fever".
    const answerTokens = tokenize(input.studentAnswer, {
      removeStopwords: false,
      minLength: 1,
    });
    const context = annotateContextDetailed(answerTokens);
    const compiled = input.keyPoints.map((p) => this.compile(p));

    const outcomes: PointOutcome[] = [];
    const matchedTokenIndices = new Set<number>();

    for (const point of compiled) {
      const outcome = this.matchPoint(point, answerTokens, context, matchedTokenIndices);
      outcomes.push(outcome);
    }

    return this.aggregate(input, outcomes, answerTokens, matchedTokenIndices);
  }

  private compile(point: KeyPoint): CompiledPoint {
    const surfaceForms = [point.text, ...point.synonyms];
    const forms = surfaceForms
      .map((form) => {
        const tokens = tokenize(form, { removeStopwords: false, minLength: 1 });
        return {
          tokens,
          // The stemmed join, not the raw normalized string. The fuzzy step
          // compares this against a window of *stemmed* answer tokens; mixing
          // stemmed and unstemmed text depresses every similarity score and
          // silently disables spelling tolerance.
          text: tokens.join(' '),
        };
      })
      .filter((f) => f.tokens.length > 0);

    const concepts = new Set<string>();
    for (const form of forms) {
      for (const conceptId of this.lexicon.conceptsIn(form.tokens)) concepts.add(conceptId);
    }
    return { point, forms, concepts };
  }

  /**
   * Attempts to match one key point against the answer, cheapest test first.
   *
   * Order matters for both cost and correctness: an exact phrase hit is
   * unambiguous and must win over a fuzzy hit elsewhere in the answer that
   * happens to score higher.
   */
  private matchPoint(
    compiled: CompiledPoint,
    answerTokens: readonly string[],
    context: readonly TokenContext[],
    matchedTokenIndices: Set<number>,
  ): PointOutcome {
    const { point } = compiled;

    // --- 1. Exact / synonym phrase occurrence -------------------------------
    for (const [formIndex, form] of compiled.forms.entries()) {
      const at = findSubsequence(answerTokens, form.tokens);
      if (at < 0) continue;
      const end = at + form.tokens.length;
      const kind = externalSpanContext(context, at, end);
      markRange(matchedTokenIndices, at, end);
      return this.outcomeFromContext(
        point,
        kind,
        formIndex === 0 ? 'exact' : 'synonym',
        answerTokens.slice(at, end).join(' '),
      );
    }

    // --- 2. Concept match through the controlled vocabulary -----------------
    //
    // Every concept the point names must be present, not merely one of them.
    // Matching on any single concept credits a point for a coincidence: the
    // pitfall "antibiotics cure appendicitis without surgery" names both
    // C:ANTIBIOTIC and C:SURGERY, and a student writing "it is a safe
    // operation" names C:SURGERY alone - enough to trigger the penalty under
    // an any-of rule, and plainly wrong.
    if (compiled.concepts.size > 0) {
      const annotations = this.lexicon.annotate(answerTokens);
      const present = new Map<string, (typeof annotations)[number]>();
      for (const annotation of annotations) {
        if (compiled.concepts.has(annotation.conceptId) && !present.has(annotation.conceptId)) {
          present.set(annotation.conceptId, annotation);
        }
      }

      if (present.size === compiled.concepts.size) {
        // Context is taken over the union of the matched spans, so a negation
        // covering any component negates the whole point.
        let kind: ContextKind = 'AFFIRMED';
        let matchedText = '';
        for (const annotation of present.values()) {
          const spanKind = externalSpanContext(context, annotation.start, annotation.end);
          if (spanKind === 'NEGATED') kind = 'NEGATED';
          else if (spanKind === 'HEDGED' && kind === 'AFFIRMED') kind = 'HEDGED';
          markRange(matchedTokenIndices, annotation.start, annotation.end);
          matchedText = matchedText === '' ? annotation.surfaceForm : `${matchedText} + ${annotation.surfaceForm}`;
        }
        return this.outcomeFromContext(point, kind, 'concept', matchedText);
      }

      // --- 3. Broader concept: true but less specific ----------------------
      // Restricted to single-concept points. For a point naming several
      // concepts, "broader" is ambiguous - broader in which component? - and
      // guessing there produces exactly the false credit rule 2 just removed.
      for (const annotation of compiled.concepts.size === 1 ? annotations : []) {
        const isBroader = [...compiled.concepts].some((target) =>
          this.lexicon.isNarrowerOrEqual(target, annotation.conceptId),
        );
        if (!isBroader) continue;
        const kind = externalSpanContext(context, annotation.start, annotation.end);
        if (kind === 'NEGATED') {
          return {
            pointId: point.id,
            text: point.text,
            status: 'NEGATED',
            credit: 0,
            matchedVia: 'broader-concept',
            matchedText: annotation.surfaceForm,
          };
        }
        markRange(matchedTokenIndices, annotation.start, annotation.end);
        const credit =
          this.options.broaderCredit * (kind === 'HEDGED' ? this.options.hedgeCredit : 1);
        return {
          pointId: point.id,
          text: point.text,
          status: 'PARTIAL',
          credit,
          matchedVia: 'broader-concept',
          matchedText: annotation.surfaceForm,
        };
      }
    }

    // --- 4. Fuzzy window match: spelling errors ------------------------------
    //
    // Two tests, because they catch different errors. Token-wise edit distance
    // catches typos, which are edit operations by nature: "wond infecton" is
    // one insertion away from "wound infection" in each token, while its
    // trigram Dice against the correct spelling is only 0.69 - well under any
    // threshold safe to use globally. Phrase-level Dice catches the rest:
    // reordering, an extra particle, a merged word.
    for (const form of compiled.forms) {
      const width = form.tokens.length;
      for (let i = 0; i + width <= answerTokens.length; i++) {
        const window = answerTokens.slice(i, i + width);
        if (!tokensWithinTypoBudget(window, form.tokens)) {
          const dice = diceCoefficient(window.join(' '), form.text, 3);
          if (dice < this.options.fuzzyThreshold) continue;
        }
        const kind = externalSpanContext(context, i, i + width);
        markRange(matchedTokenIndices, i, i + width);
        return this.outcomeFromContext(point, kind, 'fuzzy', window.join(' '));
      }
    }

    // --- 5. Multi-word point partially present ------------------------------
    // "intra-abdominal abscess" when the student wrote only "abscess".
    const firstForm = compiled.forms[0];
    if (firstForm !== undefined && firstForm.tokens.length > 1) {
      const overlap = containment(firstForm.tokens, answerTokens);
      if (overlap >= 0.6) {
        return {
          pointId: point.id,
          text: point.text,
          status: 'PARTIAL',
          credit: this.options.broaderCredit,
          matchedVia: 'fuzzy',
          matchedText: null,
        };
      }
    }

    return {
      pointId: point.id,
      text: point.text,
      status: 'MISSING',
      credit: 0,
      matchedVia: null,
      matchedText: null,
    };
  }

  private outcomeFromContext(
    point: KeyPoint,
    kind: ContextKind,
    via: PointOutcome['matchedVia'],
    matchedText: string,
  ): PointOutcome {
    if (kind === 'NEGATED') {
      // The student said the opposite. Zero credit, and the outcome records
      // *why*, so a disputed mark can be explained with the trigger word.
      return { pointId: point.id, text: point.text, status: 'NEGATED', credit: 0, matchedVia: via, matchedText };
    }
    if (kind === 'HEDGED') {
      return {
        pointId: point.id,
        text: point.text,
        status: 'HEDGED',
        credit: this.options.hedgeCredit,
        matchedVia: via,
        matchedText,
      };
    }
    return { pointId: point.id, text: point.text, status: 'COVERED', credit: 1, matchedVia: via, matchedText };
  }

  private aggregate(
    input: EvaluationInput,
    outcomes: readonly PointOutcome[],
    answerTokens: readonly string[],
    matchedTokenIndices: ReadonlySet<number>,
  ): EvaluationResult {
    const byId = new Map(input.keyPoints.map((p) => [p.id, p]));

    let earned = 0;
    let possible = 0;
    const covered: string[] = [];
    const missing: string[] = [];
    const pitfalls: string[] = [];

    for (const outcome of outcomes) {
      const point = byId.get(outcome.pointId);
      if (point === undefined) continue;

      if (point.isPitfall) {
        // A pitfall is a point the student must NOT say. Saying it is penalised;
        // not saying it is simply correct and contributes nothing either way.
        if (outcome.status === 'COVERED' || outcome.status === 'HEDGED') {
          pitfalls.push(point.id);
        }
        continue;
      }

      possible += point.weight;
      earned += outcome.credit * point.weight;

      if (outcome.status === 'COVERED') covered.push(point.id);
      else if (outcome.credit === 0) missing.push(point.id);
    }

    const rawCoverage = possible === 0 ? 0 : earned / possible;
    const penalty = pitfalls.length * this.options.pitfallPenalty;
    const score = clamp01(rawCoverage - penalty);

    // Section 11's baseline: full coverage is CORRECT, any coverage is PARTIAL,
    // none is INCORRECT. A triggered pitfall can never leave an answer CORRECT.
    let correctness: Correctness;
    if (possible === 0) {
      correctness = 'INCORRECT';
    } else if (rawCoverage >= this.options.correctThreshold && pitfalls.length === 0) {
      correctness = 'CORRECT';
    } else if (score > 0) {
      correctness = 'PARTIAL';
    } else {
      correctness = 'INCORRECT';
    }

    // Content words the student used that matched nothing known.
    const unmatched: string[] = [];
    const seen = new Set<string>();
    const contentTokens = tokenize(input.studentAnswer);
    const contentSet = new Set(contentTokens);
    answerTokens.forEach((token, index) => {
      if (matchedTokenIndices.has(index)) return;
      if (!contentSet.has(token)) return;
      if (seen.has(token)) return;
      if (this.lexicon.conceptsIn([token]).size > 0) return;
      seen.add(token);
      unmatched.push(token);
    });

    return {
      correctness,
      score: Math.round(score * 10000) / 10000,
      coveredPoints: covered,
      missingPoints: missing,
      triggeredPitfalls: pitfalls,
      outcomes,
      unmatchedTerms: unmatched,
      feedback: buildFeedback(outcomes, byId, pitfalls),
      confidence: confidenceOf(outcomes, unmatched.length),
      evaluatorVersion: EVALUATOR_VERSION,
    };
  }
}

/**
 * Confidence in the verdict itself.
 *
 * Low when many points matched only fuzzily, or when the answer contained a lot
 * of vocabulary the evaluator did not recognise - both signals that a human
 * should look. Exposed so the UI can offer "request review" on low-confidence
 * marks rather than presenting every score as equally certain.
 */
function confidenceOf(outcomes: readonly PointOutcome[], unmatchedCount: number): number {
  if (outcomes.length === 0) return 0;
  let sum = 0;
  for (const outcome of outcomes) {
    switch (outcome.matchedVia) {
      case 'exact':
      case 'synonym':
        sum += 1;
        break;
      case 'concept':
        sum += 0.95;
        break;
      case 'broader-concept':
        sum += 0.75;
        break;
      case 'fuzzy':
        sum += 0.6;
        break;
      default:
        // A confident MISSING is still confident: the point simply is not there.
        sum += 0.85;
    }
  }
  const base = sum / outcomes.length;
  const unmatchedPenalty = Math.min(0.3, unmatchedCount * 0.03);
  return Math.round(clamp01(base - unmatchedPenalty) * 10000) / 10000;
}

function buildFeedback(
  outcomes: readonly PointOutcome[],
  byId: ReadonlyMap<string, KeyPoint>,
  pitfalls: readonly string[],
): string {
  const parts: string[] = [];
  const negated = outcomes.filter((o) => o.status === 'NEGATED');
  const missing = outcomes.filter(
    (o) => o.status === 'MISSING' && byId.get(o.pointId)?.isPitfall !== true,
  );
  const partial = outcomes.filter((o) => o.status === 'PARTIAL' || o.status === 'HEDGED');

  if (negated.length > 0) {
    parts.push(`Stated as absent or excluded: ${negated.map((o) => o.text).join(', ')}.`);
  }
  if (partial.length > 0) {
    parts.push(`Mentioned but not specific or not asserted: ${partial.map((o) => o.text).join(', ')}.`);
  }
  if (missing.length > 0) {
    parts.push(`Not mentioned: ${missing.map((o) => o.text).join(', ')}.`);
  }
  if (pitfalls.length > 0) {
    const texts = pitfalls.map((id) => byId.get(id)?.text ?? id);
    parts.push(`Incorrect statements included: ${texts.join(', ')}.`);
  }
  if (parts.length === 0) return 'All required points covered.';
  return parts.join(' ');
}


/**
 * Whether every token in `window` is within a typo budget of its counterpart.
 *
 * The budget scales with token length and is zero for tokens of three
 * characters or fewer, so short clinical tokens stay exact: "cat" must not
 * match "car", and more to the point "hypo" must not match "hyper". Longer
 * tokens get one edit, and eight characters or more get two, which covers the
 * realistic handwriting-to-keyboard error rate without opening the door to
 * unrelated words of similar length.
 */
function tokensWithinTypoBudget(
  window: readonly string[],
  formTokens: readonly string[],
): boolean {
  if (window.length !== formTokens.length) return false;
  for (let i = 0; i < window.length; i++) {
    const a = window[i] as string;
    const b = formTokens[i] as string;
    if (a === b) continue;
    const longest = Math.max(a.length, b.length);
    if (longest <= 3) return false;
    const budget = longest >= 8 ? 2 : 1;
    if (levenshtein(a, b, budget) > budget) return false;
  }
  return true;
}

/** Index of the first occurrence of `needle` as a contiguous run in `haystack`. */
function findSubsequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function markRange(set: Set<number>, start: number, end: number): void {
  for (let i = start; i < end; i++) set.add(i);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Section 13's provider interface. A semantic evaluator would implement this too. */
export interface AnswerEvaluationProvider {
  readonly name: string;
  readonly version: string;
  evaluate(input: EvaluationInput): Promise<EvaluationResult> | EvaluationResult;
}

export const deterministicProvider: AnswerEvaluationProvider = {
  name: 'deterministic',
  version: EVALUATOR_VERSION,
  evaluate: (input) => new DeterministicEvaluator().evaluate(input),
};
