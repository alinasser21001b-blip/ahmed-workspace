import { add, compare, isPositive, min as minMoney, subtract, zero } from "./money.js";
import { convert, invertRate } from "./rate.js";
import { known, unknown } from "./evidence.js";
const DISCLAIMER = 'This is a planning estimate. Final bank/ATM settlement may differ. ' +
    'هذه خطة تقديرية، وقد تختلف التسوية النهائية من البنك أو الصراف.';
function sarCapacityFromNative(amount, sarToNative) {
    // amount is in native; we want how much SAR it buys.
    return convert(amount, invertRate(sarToNative), 'DOWN');
}
/**
 * Build a withdrawal plan for a SAR target.
 *
 * The plan is ordered by evidence: cards with a verified economic rate come
 * first and cheapest-first among themselves; cards priced only from a reference
 * rate follow, clearly marked. A card with neither is not allocated at all,
 * because allocating it would mean asserting a cost the system cannot support.
 */
export function planWithdrawals(targetSar, cards, opts = {}) {
    if (targetSar.currency !== 'SAR') {
        throw new TypeError(`Plan target must be SAR, received ${targetSar.currency}`);
    }
    const atmMax = opts.atmPerTransactionMaxSar ?? { minor: 500000n, currency: 'SAR' };
    const ownershipFilter = opts.ownership ?? 'ALL';
    const unusable = [];
    const candidates = [];
    for (const pc of cards) {
        const { card } = pc;
        if (ownershipFilter !== 'ALL' && card.ownership !== ownershipFilter)
            continue;
        if (!card.internationalStatus || card.internationalStatus === 'RESTRICTED_BY_REGULATION') {
            unusable.push({
                card,
                reason: 'Recorded as restricted for international use by regulation; it may not work at a Saudi ATM.',
            });
            continue;
        }
        if (card.internationalStatus === 'UNKNOWN') {
            unusable.push({
                card,
                reason: 'It is not established whether this card works abroad. Confirm with the issuer before relying on it.',
            });
            continue;
        }
        const rate = pc.verifiedNativePerSar ?? pc.referenceNativePerSar ?? null;
        const rateBasis = pc.verifiedNativePerSar
            ? 'VERIFIED'
            : pc.referenceNativePerSar
                ? 'REFERENCE'
                : null;
        if (!rate || !rateBasis) {
            unusable.push({
                card,
                reason: 'No verified or reference rate for this card, so how much SAR its balance yields cannot be estimated.',
            });
            continue;
        }
        if (rate.from !== 'SAR' || rate.to !== card.nativeCurrency) {
            throw new TypeError(`Planner rate for ${card.nickname} must be SAR -> ${card.nativeCurrency}, got ${rate.from} -> ${rate.to}`);
        }
        const notes = [];
        let capacity = null;
        let binding = 'AVAILABLE_BALANCE';
        if (pc.availableNative) {
            let spendable = pc.availableNative;
            if (pc.pendingNative && isPositive(pc.pendingNative)) {
                spendable = subtract(spendable, pc.pendingNative);
                notes.push('Pending, unsettled amounts have been deducted from the usable balance.');
            }
            if (spendable.minor <= 0n) {
                unusable.push({ card, reason: 'No usable balance once pending amounts are deducted.' });
                continue;
            }
            capacity = sarCapacityFromNative(spendable, rate);
            binding = 'AVAILABLE_BALANCE';
        }
        else {
            unusable.push({
                card,
                reason: 'No confirmed available balance, so no capacity can be planned against it.',
            });
            continue;
        }
        if (pc.dailyAtmLimit) {
            const limitSar = pc.dailyAtmLimit.currency === 'SAR'
                ? pc.dailyAtmLimit
                : sarCapacityFromNative(pc.dailyAtmLimit, rate);
            const usedToday = pc.withdrawnTodaySar ?? zero('SAR');
            const remainingToday = subtract(limitSar, usedToday);
            if (remainingToday.minor <= 0n) {
                unusable.push({ card, reason: "Today's configured withdrawal limit is already used up." });
                continue;
            }
            if (compare(remainingToday, capacity) < 0) {
                capacity = remainingToday;
                binding = 'DAILY_LIMIT';
            }
        }
        else {
            notes.push('No daily limit is recorded for this card; capacity is not capped by one.');
        }
        if (pc.regulatoryMonthlyRemaining) {
            const regSar = pc.regulatoryMonthlyRemaining.currency === 'SAR'
                ? pc.regulatoryMonthlyRemaining
                : sarCapacityFromNative(pc.regulatoryMonthlyRemaining, rate);
            if (regSar.minor <= 0n) {
                unusable.push({
                    card,
                    reason: 'The regulatory monthly allowance for use abroad is exhausted for this card.',
                });
                continue;
            }
            if (compare(regSar, capacity) < 0) {
                capacity = regSar;
                binding = 'REGULATORY_MONTHLY_CAP';
            }
        }
        if (capacity.minor <= 0n) {
            unusable.push({ card, reason: 'No remaining capacity on this card.' });
            continue;
        }
        candidates.push({ pc, rate, rateBasis, capacitySar: capacity, binding, notes });
    }
    // Verified evidence first; then cheapest.
    candidates.sort((a, b) => {
        if (a.rateBasis !== b.rateBasis)
            return a.rateBasis === 'VERIFIED' ? -1 : 1;
        const l = a.rate.num * b.rate.den;
        const r = b.rate.num * a.rate.den;
        // Rates are SAR -> native in different currencies; only compare within the
        // same currency, otherwise keep the original order.
        if (a.pc.card.nativeCurrency !== b.pc.card.nativeCurrency)
            return 0;
        return l < r ? -1 : l > r ? 1 : 0;
    });
    const allocations = [];
    let remaining = targetSar;
    for (const c of candidates) {
        if (remaining.minor <= 0n)
            break;
        let take = minMoney(remaining, c.capacitySar);
        let binding = compare(c.capacitySar, remaining) < 0 ? c.binding : 'TARGET_MET';
        let perWithdrawal = atmMax;
        let perBinding = 'ATM_MAX';
        if (c.pc.perTransactionLimit) {
            const ptSar = c.pc.perTransactionLimit.currency === 'SAR'
                ? c.pc.perTransactionLimit
                : sarCapacityFromNative(c.pc.perTransactionLimit, c.rate);
            if (compare(ptSar, perWithdrawal) < 0) {
                perWithdrawal = ptSar;
                perBinding = 'PER_TRANSACTION_LIMIT';
            }
        }
        if (perWithdrawal.minor <= 0n)
            continue;
        // Whole number of trips to the machine.
        const count = Number((take.minor + perWithdrawal.minor - 1n) / perWithdrawal.minor);
        if (compare(take, perWithdrawal) > 0) {
            c.notes.push(`Requires ${count} separate withdrawals — the per-withdrawal cap here is the ${perBinding === 'ATM_MAX' ? 'Saudi ATM maximum' : "card's per-transaction limit"}.`);
        }
        const cost = known(convert(take, c.rate), c.rateBasis === 'VERIFIED' ? 'DERIVED_CALCULATION' : 'REFERENCE_RATE', c.rateBasis === 'VERIFIED' ? 'POSTED' : 'ESTIMATED', c.rateBasis === 'VERIFIED'
            ? 'Estimated from this card’s own reconciled withdrawals.'
            : 'Estimated from a reference rate, not from this card’s settled history.');
        allocations.push({
            card: c.pc.card,
            sar: take,
            withdrawalCount: count,
            perWithdrawalSar: perWithdrawal,
            estimatedCostNative: cost,
            rateBasis: c.rateBasis,
            bindingConstraint: binding,
            notes: c.notes,
        });
        remaining = subtract(remaining, take);
    }
    const allocatedSar = subtract(targetSar, remaining);
    const shortfallSar = remaining.minor > 0n ? remaining : zero('SAR');
    // Total IQD cost only where every allocation is an IQD card with a verified
    // rate. Mixing an unconverted USD cost into an IQD total would be exactly the
    // silent currency mixing this system exists to prevent.
    let totalEstimatedCostIqd;
    const nonIqd = allocations.filter((a) => a.card.nativeCurrency !== 'IQD');
    if (allocations.length === 0) {
        totalEstimatedCostIqd = unknown('No allocations were possible.', ['A usable card with a rate']);
    }
    else if (nonIqd.length > 0) {
        totalEstimatedCostIqd = unknown(`${nonIqd.length} allocation(s) are on non-IQD cards; their dinar cost depends on how those funds were acquired.`, ['Funding records for the non-IQD cards in this plan']);
    }
    else {
        let total = zero('IQD');
        let allKnown = true;
        for (const a of allocations) {
            if (!a.estimatedCostNative.known) {
                allKnown = false;
                break;
            }
            total = add(total, a.estimatedCostNative.value);
        }
        totalEstimatedCostIqd = allKnown
            ? known(total, 'DERIVED_CALCULATION', 'ESTIMATED', 'Sum of the estimated cost of each allocation.')
            : unknown('At least one allocation has no determinable cost.', ['Settled data for the cards in this plan']);
    }
    const verifiedCount = allocations.filter((a) => a.rateBasis === 'VERIFIED').length;
    const overallConfidence = allocations.length === 0
        ? 'NONE'
        : verifiedCount === allocations.length
            ? 'HIGH'
            : verifiedCount > 0
                ? 'MEDIUM'
                : 'LOW';
    return {
        targetSar,
        allocations,
        allocatedSar,
        shortfallSar,
        unusable,
        totalEstimatedCostIqd,
        disclaimer: DISCLAIMER,
        overallConfidence,
    };
}
