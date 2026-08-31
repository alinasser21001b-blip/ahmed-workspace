/**
 * Where a financial number came from. Attached to every calculated value so the
 * UI can never present a derived figure as though the bank had provided it.
 */
export type Provenance =
  | 'BANK_APP'
  | 'BANK_STATEMENT'
  | 'ATM_RECEIPT'
  | 'OFFICIAL_TARIFF'
  | 'USER_ENTRY'
  | 'DERIVED_CALCULATION'
  | 'REFERENCE_RATE';

/**
 * How settled a withdrawal's pricing is. Ordered weakest to strongest.
 * Only RECONCILED and VERIFIED may drive card recommendations.
 */
export type PricingConfidence =
  | 'ESTIMATED'
  | 'OBSERVED'
  | 'PENDING'
  | 'POSTED'
  | 'VERIFIED'
  | 'RECONCILED';

export const PRICING_CONFIDENCE_ORDER: readonly PricingConfidence[] = [
  'ESTIMATED',
  'OBSERVED',
  'PENDING',
  'POSTED',
  'VERIFIED',
  'RECONCILED',
];

export function confidenceRank(c: PricingConfidence): number {
  return PRICING_CONFIDENCE_ORDER.indexOf(c);
}

/** The weaker of two confidences — a combined value is only as good as its worst input. */
export function weakest(a: PricingConfidence, b: PricingConfidence): PricingConfidence {
  return confidenceRank(a) <= confidenceRank(b) ? a : b;
}

export function isTrustworthy(c: PricingConfidence): boolean {
  return c === 'RECONCILED' || c === 'VERIFIED';
}

/** How good the evidence behind a *tariff rule* is. See FINANCIAL-RESEARCH.md §2. */
export type RuleConfidence = 'VERIFIED' | 'LIKELY' | 'UNVERIFIED' | 'UNKNOWN';

/**
 * A value that may not be determinable.
 *
 * This is the mechanism behind the product's central promise: an unknown never
 * silently becomes zero. There is no function in this codebase that maps
 * `{ known: false }` to a number. When evidence is missing, `missing` names
 * exactly what would resolve it, and that list is what the UI shows the user.
 */
export type Evidenced<T> =
  | {
      readonly known: true;
      readonly value: T;
      readonly provenance: Provenance;
      readonly confidence: PricingConfidence;
      /** Human-readable explanation of how this number was arrived at. */
      readonly basis: string;
    }
  | {
      readonly known: false;
      readonly reason: string;
      readonly missing: readonly string[];
    };

export function known<T>(
  value: T,
  provenance: Provenance,
  confidence: PricingConfidence,
  basis: string,
): Evidenced<T> {
  return { known: true, value, provenance, confidence, basis };
}

export function unknown<T>(reason: string, missing: readonly string[] = []): Evidenced<T> {
  return { known: false, reason, missing };
}

export function mapEvidenced<A, B>(
  a: Evidenced<A>,
  f: (value: A) => B,
  basis?: string,
): Evidenced<B> {
  if (!a.known) return a;
  return {
    known: true,
    value: f(a.value),
    provenance: a.provenance,
    confidence: a.confidence,
    basis: basis ?? a.basis,
  };
}

/**
 * Combine two evidenced values. Unknown-ness propagates: if either input is
 * unknown the result is unknown, and the reasons and missing-evidence lists are
 * merged so the user sees everything that is blocking the answer at once.
 */
export function combine2<A, B, C>(
  a: Evidenced<A>,
  b: Evidenced<B>,
  f: (a: A, b: B) => C,
  basis: string,
  provenance: Provenance = 'DERIVED_CALCULATION',
): Evidenced<C> {
  if (!a.known && !b.known) {
    return unknown(`${a.reason}; ${b.reason}`, [...new Set([...a.missing, ...b.missing])]);
  }
  if (!a.known) return unknown(a.reason, a.missing);
  if (!b.known) return unknown(b.reason, b.missing);
  return {
    known: true,
    value: f(a.value, b.value),
    provenance,
    confidence: weakest(a.confidence, b.confidence),
    basis,
  };
}

/** All-or-nothing combination of a list. */
export function combineAll<A, B>(
  items: readonly Evidenced<A>[],
  f: (values: readonly A[]) => B,
  basis: string,
  provenance: Provenance = 'DERIVED_CALCULATION',
): Evidenced<B> {
  const values: A[] = [];
  const reasons: string[] = [];
  const missing: string[] = [];
  let confidence: PricingConfidence = 'RECONCILED';
  for (const item of items) {
    if (!item.known) {
      reasons.push(item.reason);
      missing.push(...item.missing);
      continue;
    }
    values.push(item.value);
    confidence = weakest(confidence, item.confidence);
  }
  if (reasons.length > 0) return unknown(reasons.join('; '), [...new Set(missing)]);
  return { known: true, value: f(values), provenance, confidence, basis };
}

/**
 * Explicitly read an evidenced value or fail loudly.
 *
 * Named to be uncomfortable on purpose. Nothing in the rendering path may call
 * it; it exists for tests and for code paths that have already checked `known`.
 */
export function expectKnown<T>(e: Evidenced<T>, context: string): T {
  if (!e.known) {
    throw new Error(`${context}: value is not determinable — ${e.reason}`);
  }
  return e.value;
}
