import type { CurrencyCode } from './currency.ts';
import {
  add,
  compare,
  type Money,
  percentOf,
  zero,
} from './money.ts';
import {
  type Evidenced,
  known,
  type RuleConfidence,
  unknown,
} from './evidence.ts';

export type FeeRuleType =
  | 'ATM_WITHDRAWAL_FEE'
  | 'FX_FEE'
  | 'INTERNATIONAL_FEE'
  | 'CASH_ADVANCE_FEE'
  | 'ANNUAL_FEE'
  | 'TRANSFER_FEE'
  | 'OTHER';

export type FeeTransactionType = 'ATM_WITHDRAWAL' | 'POS' | 'ONLINE' | 'TRANSFER' | 'ANY';
export type FeeRegion = 'CEMEA' | 'NON_CEMEA' | 'DOMESTIC' | 'ANY';

/**
 * An effective-dated tariff rule.
 *
 * Tariffs are data, never code. A bank changing its prices inserts a new row
 * and closes the old one; it never edits an existing row. That is what keeps a
 * withdrawal made last week priced at last week's tariff.
 */
export interface FeeRule {
  readonly id: string;
  readonly cardId?: string | null;
  readonly issuer?: string | null;
  readonly product?: string | null;
  readonly ruleType: FeeRuleType;
  readonly transactionType: FeeTransactionType;
  readonly region: FeeRegion;
  /** Fixed component. */
  readonly amount?: Money | null;
  /** Percentage component, as an exact decimal string ("2", "2.5"). */
  readonly percent?: string | null;
  /** Floor/ceiling applied to a percentage fee. */
  readonly min?: Money | null;
  readonly max?: Money | null;
  /**
   * When true, `min`/`max` bound the *fixed fee itself* rather than clamping a
   * percentage — the published figure was a range. Research record NEO-02 is
   * exactly this: "3,000–4,000 IQD", with no stated trigger for either end.
   * The engine carries the range through; it never picks a midpoint.
   */
  readonly amountIsRange?: boolean;
  readonly currency: CurrencyCode;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly sourceId: string;
  readonly confidence: RuleConfidence;
  readonly verifiedAt?: string | null;
  readonly isAmbiguous?: boolean;
  readonly ambiguityNote?: string | null;
  readonly notes?: string;
}

export type FeeEstimate =
  | { readonly kind: 'EXACT'; readonly amount: Money }
  | { readonly kind: 'RANGE'; readonly min: Money; readonly max: Money; readonly note: string };

export interface RuleQuery {
  readonly cardId?: string;
  readonly issuer?: string;
  readonly product?: string;
  readonly transactionType: FeeTransactionType;
  readonly region: FeeRegion;
  /** ISO date (YYYY-MM-DD) of the transaction, NOT of today. */
  readonly onDate: string;
  readonly ruleType?: FeeRuleType;
}

function dateApplies(rule: FeeRule, onDate: string): boolean {
  if (rule.effectiveFrom > onDate) return false;
  if (rule.effectiveTo && rule.effectiveTo < onDate) return false;
  return true;
}

function scopeMatches(rule: FeeRule, q: RuleQuery): boolean {
  if (rule.cardId) {
    if (rule.cardId !== q.cardId) return false;
  } else {
    // A product template. Both issuer and product must match when both are set
    // on the rule — a NEO 964 rule must never be applied to a NEO Platinum.
    if (rule.issuer && rule.issuer !== q.issuer) return false;
    if (rule.product && rule.product !== q.product) return false;
    if (!rule.issuer && !rule.product) return false;
  }
  if (rule.transactionType !== 'ANY' && rule.transactionType !== q.transactionType) return false;
  if (rule.region !== 'ANY' && rule.region !== q.region) return false;
  if (q.ruleType && rule.ruleType !== q.ruleType) return false;
  return true;
}

/**
 * Select the rules in force for a transaction. Card-specific rules take
 * precedence over product templates for the same rule type — an override the
 * user has confirmed with their bank beats a researched default.
 */
export function resolveRules(rules: readonly FeeRule[], q: RuleQuery): FeeRule[] {
  const applicable = rules.filter((r) => dateApplies(r, q.onDate) && scopeMatches(r, q));
  const byType = new Map<FeeRuleType, FeeRule[]>();
  for (const r of applicable) {
    const list = byType.get(r.ruleType) ?? [];
    list.push(r);
    byType.set(r.ruleType, list);
  }
  const out: FeeRule[] = [];
  for (const [, list] of byType) {
    const cardSpecific = list.filter((r) => r.cardId);
    out.push(...(cardSpecific.length > 0 ? cardSpecific : list));
  }
  return out;
}

/**
 * Evaluate one rule against a base amount.
 *
 * Tariff-derived figures are always `ESTIMATED`, whatever the rule's own
 * confidence. Even a perfectly verified published tariff is a prediction of
 * what will post, not an observation of it — and this system's stronger
 * confidences are reserved for things actually measured.
 */
export function evaluateRule(rule: FeeRule, base: Money): Evidenced<FeeEstimate> {
  if (rule.confidence === 'UNKNOWN') {
    return unknown(
      `Fee rule "${rule.ruleType}" for this card is recorded as UNKNOWN and has no value.`,
      [`Confirm ${rule.ruleType} with ${rule.issuer ?? 'the issuer'}`],
    );
  }

  const basis =
    `${rule.ruleType} per tariff (${rule.confidence}, effective ${rule.effectiveFrom}` +
    `${rule.effectiveTo ? ` to ${rule.effectiveTo}` : ''}, source ${rule.sourceId})`;

  if (rule.amountIsRange) {
    if (!rule.min || !rule.max) {
      return unknown(`Rule ${rule.id} is marked as a range but has no bounds.`, [
        `Confirm exact ${rule.ruleType} amount`,
      ]);
    }
    return known(
      {
        kind: 'RANGE',
        min: rule.min,
        max: rule.max,
        note: rule.ambiguityNote ?? 'Published as a range; exact trigger not established.',
      },
      'OFFICIAL_TARIFF',
      'ESTIMATED',
      basis,
    );
  }

  if (rule.percent != null) {
    if (base.currency !== rule.currency && rule.min == null && rule.max == null) {
      // Percentage of an amount is currency-agnostic in proportion, but the
      // result is denominated in the base currency; that is fine. Clamps are
      // not, since they are absolute amounts in the rule's own currency.
    }
    let fee = percentOf(base, rule.percent);
    if (rule.min && rule.min.currency === fee.currency && compare(fee, rule.min) < 0) fee = rule.min;
    if (rule.max && rule.max.currency === fee.currency && compare(fee, rule.max) > 0) fee = rule.max;
    return known({ kind: 'EXACT', amount: fee }, 'OFFICIAL_TARIFF', 'ESTIMATED', basis);
  }

  if (rule.amount) {
    return known({ kind: 'EXACT', amount: rule.amount }, 'OFFICIAL_TARIFF', 'ESTIMATED', basis);
  }

  return unknown(`Fee rule ${rule.id} carries neither an amount nor a percentage.`, [
    `Confirm ${rule.ruleType} value with ${rule.issuer ?? 'the issuer'}`,
  ]);
}

/**
 * Total estimated fee across all applicable rules, in the card's own currency.
 *
 * Rules denominated in a different currency from the base are NOT converted —
 * doing so would require a rate, and inventing one here would smuggle an
 * unverified FX assumption into a fee total. They are reported as unconverted
 * so the caller can show them separately.
 */
export interface FeeBreakdown {
  readonly total: Evidenced<FeeEstimate>;
  readonly components: readonly { rule: FeeRule; estimate: Evidenced<FeeEstimate> }[];
  readonly unconverted: readonly { rule: FeeRule; estimate: FeeEstimate }[];
}

export function estimateFees(
  rules: readonly FeeRule[],
  q: RuleQuery,
  base: Money,
): FeeBreakdown {
  const applicable = resolveRules(rules, q);
  const components = applicable.map((rule) => ({ rule, estimate: evaluateRule(rule, base) }));

  const unconverted: { rule: FeeRule; estimate: FeeEstimate }[] = [];
  let lo = zero(base.currency);
  let hi = zero(base.currency);
  const reasons: string[] = [];
  const missing: string[] = [];
  let sawRange = false;
  const notes: string[] = [];

  for (const { rule, estimate } of components) {
    if (!estimate.known) {
      reasons.push(estimate.reason);
      missing.push(...estimate.missing);
      continue;
    }
    const est = estimate.value;
    const cur = est.kind === 'EXACT' ? est.amount.currency : est.min.currency;
    if (cur !== base.currency) {
      unconverted.push({ rule, estimate: est });
      continue;
    }
    if (est.kind === 'EXACT') {
      lo = add(lo, est.amount);
      hi = add(hi, est.amount);
    } else {
      sawRange = true;
      notes.push(est.note);
      lo = add(lo, est.min);
      hi = add(hi, est.max);
    }
  }

  if (applicable.length === 0) {
    return {
      total: unknown(
        'No tariff rule on file for this card and transaction type.',
        ['Add a confirmed fee rule for this card, or record a settled withdrawal'],
      ),
      components,
      unconverted,
    };
  }

  if (reasons.length > 0) {
    return {
      total: unknown(reasons.join('; '), [...new Set(missing)]),
      components,
      unconverted,
    };
  }

  const total: Evidenced<FeeEstimate> = sawRange
    ? known(
        { kind: 'RANGE', min: lo, max: hi, note: [...new Set(notes)].join(' ') },
        'OFFICIAL_TARIFF',
        'ESTIMATED',
        'Sum of applicable tariff rules; at least one is published as a range.',
      )
    : known(
        { kind: 'EXACT', amount: lo },
        'OFFICIAL_TARIFF',
        'ESTIMATED',
        'Sum of applicable tariff rules.',
      );

  return { total, components, unconverted };
}

export function formatFeeEstimate(
  est: FeeEstimate,
  fmt: (m: Money) => string,
): string {
  return est.kind === 'EXACT' ? fmt(est.amount) : `${fmt(est.min)} – ${fmt(est.max)}`;
}
