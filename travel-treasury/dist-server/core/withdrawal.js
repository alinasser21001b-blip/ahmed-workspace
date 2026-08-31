import { add, compare, equals, isZero, subtract, sum, zero, } from "./money.js";
import { convert, effectiveRate } from "./rate.js";
import { EV, known, MSG, unknown, weakest, } from "./evidence.js";
function provenanceOfBalanceSource(s) {
    switch (s) {
        case 'BANK_APP':
            return 'BANK_APP';
        case 'STATEMENT':
            return 'BANK_STATEMENT';
        case 'ATM_RECEIPT':
            return 'ATM_RECEIPT';
        case 'SMS':
            return 'BANK_APP';
        case 'MANUAL':
            return 'USER_ENTRY';
    }
}
function assertNative(m, card, what) {
    if (m.currency !== card.nativeCurrency) {
        throw new TypeError(`${what} is ${m.currency} but card ${card.nickname} is denominated in ` +
            `${card.nativeCurrency}. A ${card.nativeCurrency} card must not be treated as ` +
            `a ${m.currency} card.`);
    }
}
/**
 * The single canonical costing of a withdrawal. Everything that quotes a rate
 * or a cost anywhere in the product comes through here.
 */
export function computeWithdrawal(input, opts = {}) {
    const { card, dispensedSar } = input;
    const native = card.nativeCurrency;
    const warnings = [];
    const warn = (code, text) => warnings.push({ code, text });
    if (dispensedSar.currency !== 'SAR') {
        throw new TypeError(`dispensedSar must be SAR, received ${dispensedSar.currency}`);
    }
    if (dispensedSar.minor < 0n) {
        throw new RangeError('Cash dispensed cannot be negative.');
    }
    // ---- Observed balance delta -------------------------------------------
    let observedBalanceDelta;
    if (input.before && input.after) {
        assertNative(input.before.amount, card, 'Before balance');
        assertNative(input.after.amount, card, 'After balance');
        const delta = subtract(input.before.amount, input.after.amount);
        const provenance = provenanceOfBalanceSource(input.after.source);
        observedBalanceDelta = known(delta, provenance, 'OBSERVED', `Before balance minus after balance (${input.before.source}/${input.before.balanceType} → ` +
            `${input.after.source}/${input.after.balanceType}). Observed, not necessarily final.`, MSG.OBSERVED_DELTA);
        if (input.after.balanceType === 'AVAILABLE') {
            warn(MSG.W_AVAILABLE_NOT_FINAL, 'After balance is an AVAILABLE reading: it may reflect an authorisation hold rather than the final posted amount.');
        }
        if (delta.minor < 0n) {
            warn(MSG.W_BALANCE_INCREASED, 'Balance increased across this withdrawal — check the readings or look for an unrelated credit.');
        }
    }
    else {
        observedBalanceDelta = unknown('Both a before and an after balance are needed to observe the balance delta.', [input.before ? null : EV.BEFORE_BALANCE, input.after ? null : EV.AFTER_BALANCE].filter((x) => x !== null), MSG.NEED_BOTH_BALANCES);
    }
    // ---- Pending ----------------------------------------------------------
    let pendingDebitTotal;
    if (input.pending) {
        assertNative(input.pending.debit, card, 'Pending debit');
        const total = input.pending.fee
            ? add(input.pending.debit, input.pending.fee)
            : input.pending.debit;
        pendingDebitTotal = known(total, 'BANK_APP', 'PENDING', `Pending debit${input.pending.fee ? ' plus pending fee' : ''} as shown by the banking app. Not final.`, MSG.PENDING_TOTAL);
    }
    else {
        pendingDebitTotal = unknown('No pending transaction has been recorded.', [EV.PENDING_DEBIT], MSG.NO_PENDING_RECORDED);
    }
    // ---- Posted -----------------------------------------------------------
    let postedDebitTotal;
    let issuerFees;
    if (input.posted) {
        assertNative(input.posted.debit, card, 'Posted debit');
        postedDebitTotal = known(input.posted.debit, 'BANK_STATEMENT', 'POSTED', 'Final posted debit from the bank.', MSG.POSTED_DEBIT);
        const feeParts = [
            input.posted.bankFee,
            input.posted.internationalFee,
            input.posted.cashWithdrawalFee,
            input.posted.otherFee,
        ].filter((f) => f != null);
        for (const f of feeParts)
            assertNative(f, card, 'Posted fee');
        issuerFees = known(sum(feeParts, native), 'BANK_STATEMENT', 'POSTED', feeParts.length === 0
            ? 'No separately posted issuer fee recorded; any fee may be embedded in the posted debit.'
            : `Sum of ${feeParts.length} separately posted issuer fee(s).`, feeParts.length === 0 ? MSG.ISSUER_FEES_NONE : MSG.ISSUER_FEES_SUM);
    }
    else {
        postedDebitTotal = unknown('The final posted transaction has not been recorded yet.', [EV.POSTED_DEBIT], MSG.NO_POSTED_RECORDED);
        issuerFees = unknown('Issuer fees are only known once the transaction has posted.', [EV.POSTED_FEES], MSG.FEES_NEED_POSTING);
    }
    // ---- ATM operator surcharge ------------------------------------------
    const handling = input.surchargeHandling ?? 'UNKNOWN';
    let atmOperatorFee;
    if (input.atmSurcharge) {
        atmOperatorFee = known(input.atmSurcharge, 'ATM_RECEIPT', 'OBSERVED', handling === 'INCLUDED_IN_DEBIT'
            ? 'ATM operator surcharge, already included in the card debit.'
            : handling === 'POSTED_SEPARATELY'
                ? 'ATM operator surcharge, posted separately from the withdrawal.'
                : 'ATM operator surcharge as displayed. Whether it is inside the debit or posted separately is not established.', handling === 'INCLUDED_IN_DEBIT'
            ? MSG.SURCHARGE_INCLUDED
            : handling === 'POSTED_SEPARATELY'
                ? MSG.SURCHARGE_SEPARATE
                : MSG.SURCHARGE_UNKNOWN_HANDLING);
        if (handling === 'UNKNOWN') {
            warn(MSG.W_SURCHARGE_HANDLING_UNKNOWN, 'ATM surcharge recorded, but it is not established whether it sits inside the card debit or posts separately. It has not been added to the all-in cost.');
        }
    }
    else {
        atmOperatorFee = unknown('No ATM operator surcharge was recorded.', [EV.ATM_SURCHARGE], MSG.NO_SURCHARGE_RECORDED);
    }
    // ---- Native all-in cost ----------------------------------------------
    // Preference order: what the bank finally took > what we observed > what is
    // pending. Each is labelled, so the UI never implies a pending figure is final.
    let nativeAllInCost;
    let costBasis = 'NONE';
    const separateSurcharge = handling === 'POSTED_SEPARATELY' && input.atmSurcharge && input.atmSurcharge.currency === native
        ? input.atmSurcharge
        : null;
    if (handling === 'POSTED_SEPARATELY' && input.atmSurcharge && input.atmSurcharge.currency !== native) {
        warn(MSG.W_SURCHARGE_CURRENCY_UNCONVERTED, `ATM surcharge is recorded in ${input.atmSurcharge.currency} but posts separately in ${native}; ` +
            'it has not been converted or added, because converting it would require an unverified rate.');
    }
    if (postedDebitTotal.known && issuerFees.known) {
        let total = add(postedDebitTotal.value, issuerFees.value);
        if (separateSurcharge)
            total = add(total, separateSurcharge);
        nativeAllInCost = known(total, 'BANK_STATEMENT', 'POSTED', 'Posted debit plus separately posted issuer fees' +
            (separateSurcharge ? ' plus separately posted ATM surcharge.' : '.'), MSG.ALLIN_POSTED);
        costBasis = 'POSTED';
    }
    else if (observedBalanceDelta.known) {
        nativeAllInCost = known(observedBalanceDelta.value, observedBalanceDelta.provenance, 'OBSERVED', 'Observed reduction in card balance. Not yet confirmed against a posted statement.', MSG.ALLIN_OBSERVED);
        costBasis = 'OBSERVED';
    }
    else if (pendingDebitTotal.known) {
        nativeAllInCost = known(pendingDebitTotal.value, 'BANK_APP', 'PENDING', 'Pending amount only. The final posted amount frequently differs.', MSG.ALLIN_PENDING);
        costBasis = 'PENDING';
    }
    else {
        nativeAllInCost = unknown('The cost of this withdrawal in the card currency is not yet determinable.', [EV.ANY_COST_EVIDENCE], MSG.COST_NOT_DETERMINABLE);
    }
    // ---- Effective native rate -------------------------------------------
    let effectiveNativePerSar;
    if (!nativeAllInCost.known) {
        effectiveNativePerSar = unknown('Cannot determine verified effective rate yet: the cost in the card currency is unknown.', nativeAllInCost.missing, MSG.RATE_NEEDS_COST);
    }
    else if (isZero(dispensedSar)) {
        effectiveNativePerSar = unknown('No cash was dispensed, so this withdrawal has no exchange rate. A cost divided by zero cash is not a rate.', [EV.CASH_DISPENSED], MSG.NO_CASH_DISPENSED);
    }
    else {
        const r = effectiveRate(nativeAllInCost.value, dispensedSar);
        effectiveNativePerSar = r
            ? known(r, 'DERIVED_CALCULATION', nativeAllInCost.confidence, `All-in cost in ${native} divided by SAR actually dispensed (${costBasis} basis).`, MSG.RATE_FROM_ALLIN)
            : unknown('No cash dispensed.', [EV.CASH_DISPENSED], MSG.NO_CASH_DISPENSED);
    }
    // ---- Reference IQD cost (clearly labelled as reference) --------------
    let referenceIqdCost;
    if (!nativeAllInCost.known) {
        referenceIqdCost = unknown('The native cost is unknown, so no reference conversion is possible.', nativeAllInCost.missing, MSG.COST_NOT_DETERMINABLE);
    }
    else if (native === 'IQD') {
        referenceIqdCost = known(nativeAllInCost.value, nativeAllInCost.provenance, nativeAllInCost.confidence, 'Card is denominated in IQD; the native cost is the IQD cost.', MSG.IQD_CARD_NATIVE_IS_IQD);
    }
    else if (opts.referenceRate) {
        if (opts.referenceRate.from !== native || opts.referenceRate.to !== 'IQD') {
            throw new TypeError(`Reference rate must convert ${native} -> IQD, received ${opts.referenceRate.from} -> ${opts.referenceRate.to}`);
        }
        referenceIqdCost = known(convert(nativeAllInCost.value, opts.referenceRate), 'REFERENCE_RATE', 'ESTIMATED', `Reference conversion only, using ${opts.referenceRateLabel ?? 'a stored reference rate'}. ` +
            'This is NOT what these funds actually cost in dinars.', MSG.REFERENCE_CONVERSION);
    }
    else {
        referenceIqdCost = unknown(`No reference rate on file for ${native} → IQD.`, [EV.REFERENCE_RATE], MSG.NO_REFERENCE_RATE);
    }
    // ---- Economic IQD cost (the real one) --------------------------------
    let economicIqdCost;
    if (!nativeAllInCost.known) {
        economicIqdCost = unknown('The native cost is unknown.', nativeAllInCost.missing, MSG.COST_NOT_DETERMINABLE);
    }
    else if (native === 'IQD') {
        economicIqdCost = known(nativeAllInCost.value, nativeAllInCost.provenance, nativeAllInCost.confidence, 'Card is denominated in IQD; dinars leaving the card are real dinars.', MSG.IQD_CARD_REAL_DINARS);
    }
    else if (opts.funding) {
        const f = opts.funding;
        if (f.iqdPerNativeUnit.from !== native || f.iqdPerNativeUnit.to !== 'IQD') {
            throw new TypeError(`Funding basis must convert ${native} -> IQD, received ` +
                `${f.iqdPerNativeUnit.from} -> ${f.iqdPerNativeUnit.to}`);
        }
        economicIqdCost = known(convert(nativeAllInCost.value, f.iqdPerNativeUnit), 'DERIVED_CALCULATION', weakest(nativeAllInCost.confidence, 'POSTED'), `Native cost converted at the rate these ${native} funds were actually acquired at ` +
            `(${f.basis}, ${f.sampleCount} funding record(s)).`, MSG.ECONOMIC_FROM_FUNDING);
    }
    else {
        economicIqdCost = unknown(`Not enough evidence: this is a ${native} card, and the real dinar cost depends on the rate ` +
            `at which those ${native} were funded.`, [EV.FUNDING_RECORD], MSG.NEED_FUNDING_BASIS);
    }
    // ---- Verified economic IQD/SAR rate ----------------------------------
    let verifiedIqdPerSar;
    if (!economicIqdCost.known) {
        verifiedIqdPerSar = unknown('Cannot determine verified effective rate yet.', economicIqdCost.missing, economicIqdCost.code ?? MSG.RATE_NEEDS_COST);
    }
    else if (isZero(dispensedSar)) {
        verifiedIqdPerSar = unknown('No cash was dispensed, so there is no IQD/SAR rate for this withdrawal.', [EV.CASH_DISPENSED], MSG.NO_CASH_DISPENSED);
    }
    else {
        const r = effectiveRate(economicIqdCost.value, dispensedSar);
        verifiedIqdPerSar = r
            ? known(r, 'DERIVED_CALCULATION', economicIqdCost.confidence, 'Economic IQD cost divided by SAR actually dispensed.', MSG.VERIFIED_RATE_FROM_ECONOMIC)
            : unknown('No cash dispensed.', [EV.CASH_DISPENSED], MSG.NO_CASH_DISPENSED);
    }
    // ---- Warnings ---------------------------------------------------------
    if (input.dcc.offered === 'YES' && input.dcc.selection === 'BILLING_CURRENCY') {
        warn(MSG.W_DCC_ACCEPTED, 'Dynamic Currency Conversion was accepted: the ATM operator set the exchange rate, which is typically well above the network rate.');
    }
    if (input.dcc.offered === 'UNKNOWN') {
        warn(MSG.W_DCC_UNKNOWN, 'It is not recorded whether the ATM offered currency conversion (DCC).');
    }
    if (input.requestedSar && !equals(input.requestedSar, dispensedSar)) {
        warn(MSG.W_PARTIAL_DISPENSE, 'Requested and dispensed cash differ. All cost figures use the cash actually dispensed.');
    }
    if (isZero(dispensedSar)) {
        warn(MSG.W_NO_CASH, 'No cash was dispensed. This withdrawal must not credit any cash treasury.');
    }
    if (card.internationalStatus === 'RESTRICTED_BY_REGULATION') {
        warn(MSG.W_CARD_RESTRICTED, 'This card is recorded as restricted for international use by regulation.');
    }
    if (postedDebitTotal.known && observedBalanceDelta.known) {
        const posted = nativeAllInCost.known && costBasis === 'POSTED' ? nativeAllInCost.value : null;
        if (posted && compare(posted, observedBalanceDelta.value) !== 0) {
            warn(MSG.W_POSTED_VS_OBSERVED, 'The posted all-in cost differs from the observed balance change. Both are preserved; see reconciliation.');
        }
    }
    return {
        observedBalanceDelta,
        pendingDebitTotal,
        postedDebitTotal,
        issuerFees,
        atmOperatorFee,
        nativeAllInCost,
        effectiveNativePerSar,
        referenceIqdCost,
        economicIqdCost,
        verifiedIqdPerSar,
        costBasis,
        warnings,
    };
}
export function fundingBasisFrom(events, nativeCurrency) {
    if (nativeCurrency === 'IQD')
        return null;
    const usable = events.filter((e) => e.iqdPaid != null && e.credited.currency === nativeCurrency);
    if (usable.length === 0)
        return null;
    let totalIqdMinor = 0n;
    let totalCreditedMinor = 0n;
    for (const e of usable) {
        let paid = e.iqdPaid;
        if (paid.currency !== 'IQD')
            continue;
        if (e.fundingFee) {
            if (e.fundingFee.currency !== 'IQD')
                continue;
            paid = add(paid, e.fundingFee);
        }
        totalIqdMinor += paid.minor;
        totalCreditedMinor += e.credited.minor;
    }
    if (totalCreditedMinor === 0n)
        return null;
    // IQD per 1 native major unit, exact:
    //   (iqdMinor / 10^iqdScale) / (nativeMinor / 10^nativeScale)
    const iqdCost = { minor: totalIqdMinor, currency: 'IQD' };
    const credited = { minor: totalCreditedMinor, currency: nativeCurrency };
    const r = effectiveRate(iqdCost, credited);
    if (!r)
        return null;
    return {
        iqdPerNativeUnit: r,
        basis: `weighted average of recorded fundings, fees included`,
        sampleCount: usable.length,
    };
}
/** Convenience for the zero-value case used widely in aggregation. */
export function zeroNative(card) {
    return zero(card.nativeCurrency);
}
