/**
 * Knowledge classification.
 *
 * Two axes cross here, and keeping them apart is the whole point (ADR-0012):
 *
 *   kind           — how does this render?       post, question, resource, poll…
 *   knowledgeType  — what is this academically?  explanation, summary, case…
 *
 * A clinical case and a summary are both `kind = 'post'` and are not the same
 * knowledge. A `question` is the one place the two coincide, and the create
 * path sets both rather than deriving one at read time.
 *
 * Pure and I/O-free, like the rest of `@sos/core`, so the rules are covered by
 * fast unit tests rather than by clicking through a UI.
 */

import type { ContentKind, KnowledgeType } from '@sos/contracts';

/**
 * Knowledge types a given render kind may carry.
 *
 * Not every pairing is coherent: a poll is a discussion device, and calling one
 * a "summary" would put it in a filter where nobody could use it. The map is
 * the product's opinion about which combinations mean something, enforced at
 * the API boundary rather than left to the client.
 */
const ALLOWED: Record<ContentKind, readonly KnowledgeType[]> = {
  post: ['explanation', 'summary', 'note', 'case', 'discussion', 'correction', 'reference'],
  question: ['question'],
  resource: ['resource', 'reference', 'summary', 'note'],
  announcement: ['discussion'],
  poll: ['discussion'],
  // Reels and live sessions are not part of the product's centre of gravity
  // (ADR-0012). They take no knowledge type rather than being given a token one.
  reel: [],
  live: [],
};

export function allowedKnowledgeTypes(kind: ContentKind): readonly KnowledgeType[] {
  return ALLOWED[kind];
}

export function isKnowledgeTypeAllowed(kind: ContentKind, type: KnowledgeType): boolean {
  return ALLOWED[kind].includes(type);
}

/**
 * The knowledge type a kind implies on its own, when it implies one.
 *
 * Only `question` does. Everything else is genuinely ambiguous until the author
 * says — which is why the composer asks.
 */
export function impliedKnowledgeType(kind: ContentKind): KnowledgeType | null {
  return kind === 'question' ? 'question' : null;
}

// --- language ---------------------------------------------------------------

export type ContentLanguage = 'ar' | 'en' | 'mixed' | 'und';

/*
 * Script ranges. Arabic covers the base block, the supplement, extended-A and
 * the presentation forms; Latin covers ASCII letters plus Latin-1 accents. The
 * point is not linguistic completeness — it is a rule that is deterministic,
 * explainable in one sentence, and identical every time it runs.
 *
 * Written as escapes rather than literal characters: the presentation-forms
 * block ends at U+FEFF, which is invisible in an editor and identical on screen
 * to a missing character.
 */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/gu;
const LATIN = /[A-Za-z\u00C0-\u024F]/gu;

/** Below this many letters, a body is too short to classify honestly. */
const MIN_LETTERS = 8;

/** A script must hold at least this share to be called the language. */
const DOMINANT = 0.75;

/**
 * Derives the language of a body from its script distribution.
 *
 * Deterministic on purpose. A detection library or a model would be more
 * accurate on edge cases and would make "why is this post tagged English?"
 * unanswerable — and a bilingual cohort will ask. Counting letters is a rule a
 * student can be told.
 *
 * `mixed` is a real answer, not a failure: this cohort writes Arabic prose with
 * English drug names in it constantly, and forcing that into one bucket would
 * lose the fact that matters for search and for reading.
 */
export function detectLanguage(body: string | null | undefined): ContentLanguage {
  if (!body) return 'und';

  const arabic = (body.match(ARABIC) ?? []).length;
  const latin = (body.match(LATIN) ?? []).length;
  const total = arabic + latin;

  if (total < MIN_LETTERS) return 'und';
  if (arabic / total >= DOMINANT) return 'ar';
  if (latin / total >= DOMINANT) return 'en';
  return 'mixed';
}

// --- derived quality --------------------------------------------------------

/**
 * The facts a reader is shown about a piece of knowledge.
 *
 * Counts of rows, every one of which a student can click into. There is no
 * score here, and there is not going to be one (ADR-0013): a number nobody can
 * argue with is a number nobody can improve.
 */
export interface KnowledgeSignals {
  /** Citations attached to this content. */
  sourceCount: number;
  /** Corrections the author or a moderator accepted. */
  acceptedCorrectionCount: number;
  /** Corrections still awaiting a decision. */
  openCorrectionCount: number;
  /** Distinct students who marked it helpful or insightful — not likes. */
  helpfulCount: number;
  /** For a question: whether an answer was accepted. */
  hasAcceptedAnswer: boolean;
}

/**
 * How a piece of knowledge is founded — the provenance class a reader sees.
 *
 * Ordered by how much a reader should adjust their reading, most first. A
 * single label, chosen by rules, not a blend: blending is how you end up with a
 * score.
 */
export type ProvenanceClass =
  /** Corrected by the community and the author agreed. Read the correction. */
  | 'corrected'
  /** Someone has challenged it and it is unresolved. */
  | 'disputed'
  /** Attributed to a textbook, lecture, guideline or paper. */
  | 'source_backed'
  /** A student's own words, unchallenged and uncited. The honest default. */
  | 'author_claim';

export function provenanceOf(signals: KnowledgeSignals): ProvenanceClass {
  if (signals.acceptedCorrectionCount > 0) return 'corrected';
  if (signals.openCorrectionCount > 0) return 'disputed';
  if (signals.sourceCount > 0) return 'source_backed';
  return 'author_claim';
}

/**
 * Whether a reader should be shown a caution before the body.
 *
 * Only for content whose accuracy has actually been questioned. An uncited
 * explanation is not suspect — it is the normal state of a student's note, and
 * warning about it would train readers to ignore warnings.
 */
export function needsReaderCaution(signals: KnowledgeSignals): boolean {
  const provenance = provenanceOf(signals);
  return provenance === 'corrected' || provenance === 'disputed';
}
