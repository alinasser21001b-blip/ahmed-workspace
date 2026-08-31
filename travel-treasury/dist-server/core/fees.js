import { add, compare, percentOf, zero, } from "./money.js";
import { known, unknown, } from "./evidence.js";
function dateApplies(rule, onDate) {
    if (rule.effectiveFrom > onDate)
        return false;
    if (rule.effectiveTo && rule.effectiveTo < onDate)
        return false;
    return true;
}
function scopeMatches(rule, q) {
    if (rule.cardId) {
        if (rule.cardId !== q.cardId)
            return false;
    }
    else {
        // A product template. Both issuer and product must match when both are set
        // on the rule — a NEO 964 rule must never be applied to a NEO Platinum.
        if (rule.issuer && rule.issuer !== q.issuer)
            return false;
        if (rule.product && rule.product !== q.product)
            return false;
        if (!rule.issuer && !rule.product)
            return false;
    }
    if (rule.transactionType !== 'ANY' && rule.transactionType !== q.transactionType)
        return false;
    if (rule.region !== 'ANY' && rule.region !== q.region)
        return false;
    if (q.ruleType && rule.ruleType !== q.ruleType)
        return false;
    return true;
}
/**
 * Select the rules in force for a transaction. Card-specific rules take
 * precedence over product templates for the same rule type — an override the
 * user has confirmed with their bank beats a researched default.
 */
export function resolveRules(rules, q) {
    const applicable = rules.filter((r) => dateApplies(r, q.onDate) && scopeMatches(r, q));
    const byType = new Map();
    for (const r of applicable) {
        const list = byType.get(r.ruleType) ?? [];
        list.push(r);
        byType.set(r.ruleType, list);
    }
    const out = [];
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
export function evaluateRule(rule, base) {
    if (rule.confidence === 'UNKNOWN') {
        return unknown(`Fee rule "${rule.ruleType}" for this card is recorded as UNKNOWN and has no value.`, [`Confirm ${rule.ruleType} with ${rule.issuer ?? 'the issuer'}`]);
    }
    const basis = `${rule.ruleType} per tariff (${rule.confidence}, effective ${rule.effectiveFrom}` +
        `${rule.effectiveTo ? ` to ${rule.effectiveTo}` : ''}, source ${rule.sourceId})`;
    if (rule.amountIsRange) {
        if (!rule.min || !rule.max) {
            return unknown(`Rule ${rule.id} is marked as a range but has no bounds.`, [
                `Confirm exact ${rule.ruleType} amount`,
            ]);
        }
        return known({
            kind: 'RANGE',
            min: rule.min,
            max: rule.max,
            note: rule.ambiguityNote ?? 'Published as a range; exact trigger not established.',
        }, 'OFFICIAL_TARIFF', 'ESTIMATED', basis);
    }
    if (rule.percent != null) {
        if (base.currency !== rule.currency && rule.min == null && rule.max == null) {
            // Percentage of an amount is currency-agnostic in proportion, but the
            // result is denominated in the base currency; that is fine. Clamps are
            // not, since they are absolute amounts in the rule's own currency.
        }
        let fee = percentOf(base, rule.percent);
        if (rule.min && rule.min.currency === fee.currency && compare(fee, rule.min) < 0)
            fee = rule.min;
        if (rule.max && rule.max.currency === fee.currency && compare(fee, rule.max) > 0)
            fee = rule.max;
        return known({ kind: 'EXACT', amount: fee }, 'OFFICIAL_TARIFF', 'ESTIMATED', basis);
    }
    if (rule.amount) {
        return known({ kind: 'EXACT', amount: rule.amount }, 'OFFICIAL_TARIFF', 'ESTIMATED', basis);
    }
    return unknown(`Fee rule ${rule.id} carries neither an amount nor a percentage.`, [
        `Confirm ${rule.ruleType} value with ${rule.issuer ?? 'the issuer'}`,
    ]);
}
export function estimateFees(rules, q, base) {
    const applicable = resolveRules(rules, q);
    const components = applicable.map((rule) => ({ rule, estimate: evaluateRule(rule, base) }));
    const unconverted = [];
    let lo = zero(base.currency);
    let hi = zero(base.currency);
    const reasons = [];
    const missing = [];
    let sawRange = false;
    const notes = [];
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
        }
        else {
            sawRange = true;
            notes.push(est.note);
            lo = add(lo, est.min);
            hi = add(hi, est.max);
        }
    }
    if (applicable.length === 0) {
        return {
            total: unknown('No tariff rule on file for this card and transaction type.', ['Add a confirmed fee rule for this card, or record a settled withdrawal']),
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
    const total = sawRange
        ? known({ kind: 'RANGE', min: lo, max: hi, note: [...new Set(notes)].join(' ') }, 'OFFICIAL_TARIFF', 'ESTIMATED', 'Sum of applicable tariff rules; at least one is published as a range.')
        : known({ kind: 'EXACT', amount: lo }, 'OFFICIAL_TARIFF', 'ESTIMATED', 'Sum of applicable tariff rules.');
    return { total, components, unconverted };
}
export function formatFeeEstimate(est, fmt) {
    return est.kind === 'EXACT' ? fmt(est.amount) : `${fmt(est.min)} – ${fmt(est.max)}`;
}
