/**
 * Clinical case resolution.
 *
 * Section 5 puts case at "medium" auto-normalization: less strict than examiner
 * (a wrong case merge is recoverable by re-splitting; a wrong examiner merge
 * corrupts the historical asset) but stricter than question.
 *
 * The distinguishing risk is *clinically distinct variants*. "Chest pain" and
 * "Chest pain - STEMI" are lexically close and clinically different; merging
 * them silently would put an examiner's STEMI questions into a generic chest
 * pain station. The resolver therefore treats a clinical qualifier - an age
 * band, an acuity marker, a named diagnosis - as a blocking difference that
 * forces review even when the string similarity is high.
 */

import type { CaseId, ClinicalCase, SpecialtyId } from '../domain/types.ts';
import { normalizeForMatching } from '../text/normalize.ts';
import { tokenize } from '../text/tokenize.ts';
import { compositeSimilarity, jaccard } from '../text/similarity.ts';
import { Lexicon, defaultLexicon } from '../text/lexicon.ts';

export type CaseResolution =
  | { readonly kind: 'MATCHED'; readonly caseId: CaseId; readonly reason: 'EXACT' | 'ALIAS' }
  | {
      readonly kind: 'SUGGESTED';
      readonly alternatives: readonly {
        readonly caseId: CaseId;
        readonly title: string;
        readonly score: number;
        /** Set when a clinical qualifier differs, forcing human confirmation. */
        readonly qualifierConflict: string | null;
      }[];
    }
  | { readonly kind: 'NEW_CANDIDATE'; readonly suggestedTitle: string };

/**
 * Qualifiers that make two otherwise-similar case titles clinically distinct.
 *
 * Presence of a qualifier in one title but not the other is treated as a
 * conflict. This is a deliberately blunt rule: it produces some unnecessary
 * review, and it prevents the failure where "Jaundice" absorbs "Neonatal
 * Jaundice" and a paediatric station starts serving adult questions.
 */
const CLINICAL_QUALIFIERS: readonly string[] = [
  'acute', 'chronic', 'neonatal', 'paediatric', 'pediatric', 'adult', 'elderly',
  'post operative', 'postoperative', 'pre operative', 'preoperative',
  'recurrent', 'severe', 'mild', 'moderate', 'complicated', 'uncomplicated',
  'malignant', 'benign', 'traumatic', 'congenital', 'acquired',
  'حاد', 'مزمن', 'وليدي', 'بالغ', 'متكرر', 'شديد', 'خبيث', 'حميد', 'خلقي',
];

const QUALIFIER_SET: ReadonlySet<string> = new Set(
  CLINICAL_QUALIFIERS.flatMap((q) => tokenize(q, { removeStopwords: false, minLength: 1 })),
);

export interface CaseResolverOptions {
  /** Above this composite score a case is suggested. Default 0.7. */
  readonly suggestThreshold?: number;
  readonly lexicon?: Lexicon;
}

export class CaseResolver {
  private readonly suggestThreshold: number;
  private readonly lexicon: Lexicon;

  constructor(options: CaseResolverOptions = {}) {
    this.suggestThreshold = options.suggestThreshold ?? 0.7;
    this.lexicon = options.lexicon ?? defaultLexicon;
  }

  resolve(
    observedTitle: string,
    specialtyId: SpecialtyId,
    existing: readonly ClinicalCase[],
  ): CaseResolution {
    const normalized = normalizeForMatching(observedTitle);
    const tokens = tokenize(observedTitle);
    const concepts = this.lexicon.conceptsIn(tokens);
    const qualifiers = qualifiersIn(tokens);

    const inSpecialty = existing.filter((c) => c.specialtyId === specialtyId && c.active);

    // Exact title or registered alias.
    for (const candidate of inSpecialty) {
      if (normalizeForMatching(candidate.title) === normalized) {
        return { kind: 'MATCHED', caseId: candidate.id, reason: 'EXACT' };
      }
      for (const alias of candidate.aliases) {
        if (normalizeForMatching(alias) === normalized) {
          return { kind: 'MATCHED', caseId: candidate.id, reason: 'ALIAS' };
        }
      }
    }

    const alternatives = inSpecialty
      .map((candidate) => {
        const otherTokens = tokenize(candidate.title);
        const otherConcepts = this.lexicon.conceptsIn(otherTokens);
        const lexical = compositeSimilarity(
          normalized,
          normalizeForMatching(candidate.title),
          tokens,
          otherTokens,
        );
        const conceptOverlap =
          concepts.size > 0 && otherConcepts.size > 0 ? jaccard(concepts, otherConcepts) : 0;
        // Concept agreement lifts the score, but never on its own: two cases
        // sharing one concept ("infection") are not the same case.
        const score = Math.max(lexical, 0.5 * lexical + 0.5 * conceptOverlap);

        const otherQualifiers = qualifiersIn(otherTokens);
        const conflict = qualifierConflict(qualifiers, otherQualifiers);

        return { caseId: candidate.id, title: candidate.title, score, qualifierConflict: conflict };
      })
      .filter((a) => a.score >= this.suggestThreshold)
      .sort((a, b) => b.score - a.score);

    if (alternatives.length === 0) {
      return { kind: 'NEW_CANDIDATE', suggestedTitle: titleCase(observedTitle) };
    }
    return { kind: 'SUGGESTED', alternatives };
  }
}

function qualifiersIn(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) if (QUALIFIER_SET.has(token)) out.add(token);
  return out;
}

/** Returns a description of the first qualifier present in one set but not the other. */
function qualifierConflict(a: ReadonlySet<string>, b: ReadonlySet<string>): string | null {
  for (const q of a) if (!b.has(q)) return `only-in-observed:${q}`;
  for (const q of b) if (!a.has(q)) return `only-in-existing:${q}`;
  return null;
}

function titleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
