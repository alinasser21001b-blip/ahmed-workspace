/**
 * Negation and hedge detection, in the NegEx / ConText tradition.
 *
 * Why this exists: without it, "there is no evidence of DVT" is scored as
 * covering the key point "DVT". That is not a rounding error - it is the
 * grader awarding marks for the opposite of the right answer, and it is the
 * single most damaging failure mode a lexical grader has.
 *
 * NegEx (Chapman et al., 2001) remains competitive with learned models on
 * clinical negation, and two independent reviews have found rule-based
 * negation to outperform trained approaches on this task. It is also
 * inspectable: when a student disputes a mark, the trigger term and its scope
 * can be shown verbatim.
 *
 * Implemented here:
 *   - pre-condition triggers ("no", "denies", "without") scoping forward
 *   - post-condition triggers ("was ruled out", "is absent") scoping backward
 *   - scope terminators ("but", "however", "although") that end a negation
 *   - hedge/uncertainty triggers ("possible", "suspected") reported separately
 *   - Arabic triggers alongside English, since recall material is mixed
 */

import { normalizeForMatching } from './normalize';
import { stemToken } from './tokenize';

export type ContextKind = 'AFFIRMED' | 'NEGATED' | 'HEDGED';

/** Forward-scoping negation triggers: everything after them is negated. */
const PRE_NEGATION: readonly string[] = [
  'no', 'not', 'none', 'never', 'without', 'denies', 'denied', 'deny',
  'absent', 'negative for', 'rules out', 'rule out', 'ruled out',
  'no evidence of', 'no sign of', 'no signs of', 'no history of',
  'free of', 'lacks', 'lacking', 'cannot', 'cant', 'unable to',
  'fails to', 'failed to', 'excluded', 'exclude',
  // Arabic (matching-normalized forms)
  'لا', 'ليس', 'ليست', 'بدون', 'دون', 'غير', 'عدم', 'ينفي', 'نفي', 'خالي من', 'لايوجد', 'لا يوجد',
];

/** Backward-scoping negation triggers: everything before them is negated. */
const POST_NEGATION: readonly string[] = [
  'is ruled out', 'was ruled out', 'are ruled out', 'were ruled out',
  'is absent', 'was absent', 'is negative', 'was negative',
  'is excluded', 'was excluded', 'not present', 'is unlikely',
  'غير موجود', 'مستبعد', 'منفي',
];

/** Terms that terminate a negation scope. */
const TERMINATORS: readonly string[] = [
  'but', 'however', 'although', 'though', 'except', 'apart from', 'aside from',
  'nevertheless', 'yet', 'still', 'whereas', 'while',
  'لكن', 'لكن', 'الا', 'غير ان', 'بينما', 'اما',
];

/** Uncertainty markers. Not negation, but not full credit either. */
const HEDGES: readonly string[] = [
  'possible', 'possibly', 'probable', 'probably', 'suspected', 'suspect',
  'maybe', 'may be', 'might be', 'could be', 'likely', 'unlikely',
  'question of', 'consider', 'consistent with', 'cannot exclude', 'rule out',
  'ربما', 'محتمل', 'يحتمل', 'مشتبه', 'قد يكون', 'يمكن ان',
];

/** Sentence-ish boundaries. Negation never crosses one. */
const CLAUSE_BREAK = /[.;:!?\n]|,\s*(?=and\b|or\b)/;

/**
 * Triggers are compiled into both raw and stemmed token forms.
 *
 * Without this the detector silently stops working the moment stemming is
 * enabled: the tokenizer turns "denied" into "deni", which no longer equals the
 * literal trigger "denied". Matching either form makes the detector independent
 * of the caller's tokenizer settings.
 */
type CompiledTrigger = { readonly tokens: readonly string[]; readonly phrase: string };

function compileTriggers(phrases: readonly string[]): CompiledTrigger[] {
  const out: CompiledTrigger[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const normalized = normalizeForMatching(phrase);
    if (normalized.length === 0) continue;
    const raw = normalized.split(' ');
    const stemmed = raw.map(stemToken);
    for (const variant of [raw, stemmed]) {
      const key = variant.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tokens: variant, phrase });
    }
  }
  // Longest first so that "no evidence of" wins over "no".
  return out.sort((a, b) => b.tokens.length - a.tokens.length);
}

const PRE_COMPILED = compileTriggers(PRE_NEGATION);
const POST_COMPILED = compileTriggers(POST_NEGATION);
const HEDGE_COMPILED = compileTriggers(HEDGES);
const TERMINATOR_SET: ReadonlySet<string> = new Set(
  TERMINATORS.flatMap((t) => {
    const n = normalizeForMatching(t);
    return [n, stemToken(n)];
  }),
);

export interface ScopedSpan {
  /** Token index where the span starts (inclusive). */
  readonly start: number;
  /** Token index where the span ends (exclusive). */
  readonly end: number;
  readonly kind: ContextKind;
  /** The trigger phrase that produced a non-affirmed span. */
  readonly trigger: string | null;
}

/**
 * Default scope window in tokens.
 *
 * Chapman's original NegEx used six tokens; ConText's evaluation found
 * end-of-sentence scoping scored slightly higher (F 0.98 vs 0.97) on
 * development data but generalised worse. Six with clause-break termination is
 * the conservative choice: it under-negates rather than over-negates, and
 * under-negation costs a student nothing.
 */
export const DEFAULT_SCOPE_TOKENS = 6;

export interface NegationOptions {
  readonly scopeTokens?: number;
  readonly detectHedges?: boolean;
}

function matchesAt(tokens: readonly string[], index: number, trigger: CompiledTrigger): boolean {
  const parts = trigger.tokens;
  if (index + parts.length > tokens.length) return false;
  for (let i = 0; i < parts.length; i++) {
    if (tokens[index + i] !== parts[i]) return false;
  }
  return true;
}

/** Triggers are pre-sorted longest-first, so the first hit is the longest. */
function longestMatch(
  tokens: readonly string[],
  index: number,
  triggers: readonly CompiledTrigger[],
): { length: number; phrase: string | null } {
  for (const trigger of triggers) {
    if (matchesAt(tokens, index, trigger)) {
      return { length: trigger.tokens.length, phrase: trigger.phrase };
    }
  }
  return { length: 0, phrase: null };
}

/**
 * Per-token context, plus the token index of the trigger responsible.
 *
 * The trigger index is not decoration. A key point can legitimately *contain* a
 * negation word - "antibiotics cure appendicitis WITHOUT surgery" is a single
 * assertion, and the "without" inside it is part of the claim, not a negation
 * of it. Without knowing where the trigger sits, a matcher reads that phrase as
 * negated and awards no penalty for a student who asserted it. Recording the
 * trigger position lets a caller ignore negations that originate inside the
 * span being tested, which is also how NegEx scopes: a trigger governs the
 * concepts around it, never the phrase it is itself a part of.
 */
export interface TokenContext {
  readonly kind: ContextKind;
  /** Index of the trigger token that set this kind, or -1 when affirmed. */
  readonly triggerAt: number;
}

/**
 * Assigns a context kind to every token position.
 *
 * Returns a parallel array: `context[i]` is the status of `tokens[i]`.
 */
export function annotateContextDetailed(
  tokens: readonly string[],
  options: NegationOptions = {},
): TokenContext[] {
  const scope = options.scopeTokens ?? DEFAULT_SCOPE_TOKENS;
  const detectHedges = options.detectHedges ?? true;
  const detailed: TokenContext[] = new Array(tokens.length)
    .fill(null)
    .map(() => ({ kind: 'AFFIRMED' as ContextKind, triggerAt: -1 }));
  const context: ContextKind[] = new Array(tokens.length).fill('AFFIRMED');

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (TERMINATOR_SET.has(token)) continue;

    // Post-negation first: it wins over a pre-negation covering the same span,
    // because "X is ruled out" is unambiguous.
    const post = longestMatch(tokens, i, POST_COMPILED);
    if (post.length > 0) {
      for (let j = Math.max(0, i - scope); j < i; j++) {
        if (isBreak(tokens[j] as string)) continue;
        context[j] = 'NEGATED';
        detailed[j] = { kind: 'NEGATED', triggerAt: i };
      }
      for (let j = i; j < i + post.length; j++) {
        context[j] = 'NEGATED';
        detailed[j] = { kind: 'NEGATED', triggerAt: i };
      }
      i += post.length - 1;
      continue;
    }

    const pre = longestMatch(tokens, i, PRE_COMPILED);
    if (pre.length > 0) {
      const limit = Math.min(tokens.length, i + pre.length + scope);
      for (let j = i + pre.length; j < limit; j++) {
        const t = tokens[j] as string;
        if (TERMINATOR_SET.has(t) || isBreak(t)) break;
        context[j] = 'NEGATED';
        detailed[j] = { kind: 'NEGATED', triggerAt: i };
      }
      i += pre.length - 1;
      continue;
    }

    if (detectHedges) {
      const hedge = longestMatch(tokens, i, HEDGE_COMPILED);
      if (hedge.length > 0) {
        const limit = Math.min(tokens.length, i + hedge.length + scope);
        for (let j = i + hedge.length; j < limit; j++) {
          const t = tokens[j] as string;
          if (TERMINATOR_SET.has(t) || isBreak(t)) break;
          if (context[j] === 'AFFIRMED') {
            context[j] = 'HEDGED';
            detailed[j] = { kind: 'HEDGED', triggerAt: i };
          }
        }
        i += hedge.length - 1;
      }
    }
  }

  return detailed;
}

/** Kinds only, for callers that do not need trigger provenance. */
export function annotateContext(
  tokens: readonly string[],
  options: NegationOptions = {},
): ContextKind[] {
  return annotateContextDetailed(tokens, options).map((c) => c.kind);
}

function isBreak(token: string): boolean {
  return CLAUSE_BREAK.test(token);
}

/**
 * Convenience: the context of a span of tokens.
 *
 * A span is NEGATED if any of its tokens is negated (a negated head negates
 * the concept), HEDGED if any is hedged, otherwise AFFIRMED.
 */
export function spanContext(
  context: readonly ContextKind[],
  start: number,
  end: number,
): ContextKind {
  let hedged = false;
  for (let i = start; i < end && i < context.length; i++) {
    if (context[i] === 'NEGATED') return 'NEGATED';
    if (context[i] === 'HEDGED') hedged = true;
  }
  return hedged ? 'HEDGED' : 'AFFIRMED';
}

/**
 * Context of a span, counting only triggers that lie OUTSIDE it.
 *
 * This is the form a phrase matcher must use. Testing a matched key-point span
 * with the plain `spanContext` reports NEGATED whenever the key point's own
 * wording contains a negation word, which silently converts an asserted pitfall
 * into an unpenalised one.
 */
export function externalSpanContext(
  context: readonly TokenContext[],
  start: number,
  end: number,
): ContextKind {
  let hedged = false;
  for (let i = start; i < end && i < context.length; i++) {
    const entry = context[i] as TokenContext;
    if (entry.kind === 'AFFIRMED') continue;
    // A trigger inside the span is part of the matched phrase, not a negation
    // applied to it.
    if (entry.triggerAt >= start && entry.triggerAt < end) continue;
    if (entry.kind === 'NEGATED') return 'NEGATED';
    hedged = true;
  }
  return hedged ? 'HEDGED' : 'AFFIRMED';
}

/** Exposed for tests and for the reviewer-facing "why was this negated" panel. */
export const NEGATION_TRIGGERS = Object.freeze({
  pre: PRE_NEGATION,
  post: POST_NEGATION,
  terminators: TERMINATORS,
  hedges: HEDGES,
});
