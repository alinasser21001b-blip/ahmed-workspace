export const PRICING_CONFIDENCE_ORDER = [
    'ESTIMATED',
    'OBSERVED',
    'PENDING',
    'POSTED',
    'VERIFIED',
    'RECONCILED',
];
export function confidenceRank(c) {
    return PRICING_CONFIDENCE_ORDER.indexOf(c);
}
/** The weaker of two confidences — a combined value is only as good as its worst input. */
export function weakest(a, b) {
    return confidenceRank(a) <= confidenceRank(b) ? a : b;
}
export function isTrustworthy(c) {
    return c === 'RECONCILED' || c === 'VERIFIED';
}
export function known(value, provenance, confidence, basis, code) {
    return { known: true, value, provenance, confidence, basis, code };
}
export function unknown(reason, missing = [], code) {
    return { known: false, reason, missing, code };
}
export function mapEvidenced(a, f, basis) {
    if (!a.known)
        return a;
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
export function combine2(a, b, f, basis, provenance = 'DERIVED_CALCULATION') {
    if (!a.known && !b.known) {
        return unknown(`${a.reason}; ${b.reason}`, [...new Set([...a.missing, ...b.missing])]);
    }
    if (!a.known)
        return unknown(a.reason, a.missing, a.code);
    if (!b.known)
        return unknown(b.reason, b.missing, b.code);
    return {
        known: true,
        value: f(a.value, b.value),
        provenance,
        confidence: weakest(a.confidence, b.confidence),
        basis,
    };
}
/** All-or-nothing combination of a list. */
export function combineAll(items, f, basis, provenance = 'DERIVED_CALCULATION') {
    const values = [];
    const reasons = [];
    const missing = [];
    let confidence = 'RECONCILED';
    for (const item of items) {
        if (!item.known) {
            reasons.push(item.reason);
            missing.push(...item.missing);
            continue;
        }
        values.push(item.value);
        confidence = weakest(confidence, item.confidence);
    }
    if (reasons.length > 0)
        return unknown(reasons.join('; '), [...new Set(missing)]);
    return { known: true, value: f(values), provenance, confidence, basis };
}
/**
 * Explicitly read an evidenced value or fail loudly.
 *
 * Named to be uncomfortable on purpose. Nothing in the rendering path may call
 * it; it exists for tests and for code paths that have already checked `known`.
 */
export function expectKnown(e, context) {
    if (!e.known) {
        throw new Error(`${context}: value is not determinable — ${e.reason}`);
    }
    return e.value;
}
/**
 * Message codes emitted by the engine. The UI maps each to Arabic (or English);
 * exports keep the English `basis`/`reason` text alongside.
 */
export const MSG = {
    // Bases
    OBSERVED_DELTA: 'OBSERVED_DELTA',
    PENDING_TOTAL: 'PENDING_TOTAL',
    POSTED_DEBIT: 'POSTED_DEBIT',
    ISSUER_FEES_SUM: 'ISSUER_FEES_SUM',
    ISSUER_FEES_NONE: 'ISSUER_FEES_NONE',
    SURCHARGE_INCLUDED: 'SURCHARGE_INCLUDED',
    SURCHARGE_SEPARATE: 'SURCHARGE_SEPARATE',
    SURCHARGE_UNKNOWN_HANDLING: 'SURCHARGE_UNKNOWN_HANDLING',
    ALLIN_POSTED: 'ALLIN_POSTED',
    ALLIN_OBSERVED: 'ALLIN_OBSERVED',
    ALLIN_PENDING: 'ALLIN_PENDING',
    RATE_FROM_ALLIN: 'RATE_FROM_ALLIN',
    IQD_CARD_NATIVE_IS_IQD: 'IQD_CARD_NATIVE_IS_IQD',
    IQD_CARD_REAL_DINARS: 'IQD_CARD_REAL_DINARS',
    REFERENCE_CONVERSION: 'REFERENCE_CONVERSION',
    ECONOMIC_FROM_FUNDING: 'ECONOMIC_FROM_FUNDING',
    VERIFIED_RATE_FROM_ECONOMIC: 'VERIFIED_RATE_FROM_ECONOMIC',
    EXPECTED_FROM_COST: 'EXPECTED_FROM_COST',
    OBSERVED_BALANCE: 'OBSERVED_BALANCE',
    DIFFERENCE_CONFIRMED_MINUS_EXPECTED: 'DIFFERENCE_CONFIRMED_MINUS_EXPECTED',
    LEDGER_FROM_OPENING: 'LEDGER_FROM_OPENING',
    LAST_CONFIRMED: 'LAST_CONFIRMED',
    // Unknowns
    NEED_BOTH_BALANCES: 'NEED_BOTH_BALANCES',
    NO_PENDING_RECORDED: 'NO_PENDING_RECORDED',
    NO_POSTED_RECORDED: 'NO_POSTED_RECORDED',
    FEES_NEED_POSTING: 'FEES_NEED_POSTING',
    NO_SURCHARGE_RECORDED: 'NO_SURCHARGE_RECORDED',
    COST_NOT_DETERMINABLE: 'COST_NOT_DETERMINABLE',
    RATE_NEEDS_COST: 'RATE_NEEDS_COST',
    NO_CASH_DISPENSED: 'NO_CASH_DISPENSED',
    NO_REFERENCE_RATE: 'NO_REFERENCE_RATE',
    NEED_FUNDING_BASIS: 'NEED_FUNDING_BASIS',
    RECON_NEEDS_BALANCES: 'RECON_NEEDS_BALANCES',
    RECON_NEEDS_COST: 'RECON_NEEDS_COST',
    LEDGER_HAS_UNKNOWN_COSTS: 'LEDGER_HAS_UNKNOWN_COSTS',
    NO_CONFIRMED_BALANCE: 'NO_CONFIRMED_BALANCE',
    DIFF_NEEDS_BOTH: 'DIFF_NEEDS_BOTH',
    // Warnings
    W_AVAILABLE_NOT_FINAL: 'W_AVAILABLE_NOT_FINAL',
    W_BALANCE_INCREASED: 'W_BALANCE_INCREASED',
    W_SURCHARGE_HANDLING_UNKNOWN: 'W_SURCHARGE_HANDLING_UNKNOWN',
    W_SURCHARGE_CURRENCY_UNCONVERTED: 'W_SURCHARGE_CURRENCY_UNCONVERTED',
    W_DCC_ACCEPTED: 'W_DCC_ACCEPTED',
    W_DCC_UNKNOWN: 'W_DCC_UNKNOWN',
    W_PARTIAL_DISPENSE: 'W_PARTIAL_DISPENSE',
    W_NO_CASH: 'W_NO_CASH',
    W_CARD_RESTRICTED: 'W_CARD_RESTRICTED',
    W_POSTED_VS_OBSERVED: 'W_POSTED_VS_OBSERVED',
    // Explanations
    E_RECONCILED_POSTED: 'E_RECONCILED_POSTED',
    E_RECONCILED_NOT_POSTED: 'E_RECONCILED_NOT_POSTED',
    E_DIFFERENCE_NEEDS_PERSON: 'E_DIFFERENCE_NEEDS_PERSON',
    E_NOT_ENOUGH_TO_RECONCILE: 'E_NOT_ENOUGH_TO_RECONCILE',
    E_CANNOT_EXPECT_BALANCE: 'E_CANNOT_EXPECT_BALANCE',
};
/** Evidence-item codes used in `missing`. */
export const EV = {
    BEFORE_BALANCE: 'EV_BEFORE_BALANCE',
    AFTER_BALANCE: 'EV_AFTER_BALANCE',
    PENDING_DEBIT: 'EV_PENDING_DEBIT',
    POSTED_DEBIT: 'EV_POSTED_DEBIT',
    POSTED_FEES: 'EV_POSTED_FEES',
    ATM_SURCHARGE: 'EV_ATM_SURCHARGE',
    CASH_DISPENSED: 'EV_CASH_DISPENSED',
    REFERENCE_RATE: 'EV_REFERENCE_RATE',
    FUNDING_RECORD: 'EV_FUNDING_RECORD',
    SETTLEMENT_DETAILS: 'EV_SETTLEMENT_DETAILS',
    OPENING_BALANCE: 'EV_OPENING_BALANCE',
    BALANCE_READING: 'EV_BALANCE_READING',
    ANY_COST_EVIDENCE: 'EV_ANY_COST_EVIDENCE',
};
