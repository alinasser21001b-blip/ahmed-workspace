import { majorUnits, sum, zero } from "./money.js";
import { compareRates, convert, meanRate } from "./rate.js";
import { known, unknown } from "./evidence.js";
const MIN_SAMPLES_FOR_HIGH = 3;
const MIN_SAMPLES_FOR_MEDIUM = 2;
/**
 * Rank cards on evidence.
 *
 * Only RECONCILED observations count. Advertised tariffs never enter this
 * ranking — they are estimates, and the whole point of this engine is to answer
 * "which card is actually cheaper" from what really happened.
 *
 * Cards whose economic IQD cost is not knowable (a USD card with no funding
 * record) are returned as *not comparable* rather than being ranked on their
 * native rate. Comparing "270 USD per 1,000 SAR" against "388,000 IQD per
 * 1,000 SAR" would be arithmetic on two different questions.
 */
export function rankCards(evidence) {
    const rankings = evidence.map((e) => {
        const reconciled = e.observations.filter((o) => o.isReconciled && o.confidence === 'RECONCILED');
        const withIqd = reconciled.filter((o) => o.iqdPerSar !== null);
        const sorted = [...reconciled].sort((a, b) => (a.transactionAt < b.transactionAt ? 1 : -1));
        const averageNativePerSar = meanRate(reconciled.map((o) => o.nativePerSar));
        const averageIqdPerSar = meanRate(withIqd.map((o) => o.iqdPerSar));
        const lastWithIqd = sorted.find((o) => o.iqdPerSar !== null);
        let confidence = 'NONE';
        if (withIqd.length >= MIN_SAMPLES_FOR_HIGH)
            confidence = 'HIGH';
        else if (withIqd.length >= MIN_SAMPLES_FOR_MEDIUM)
            confidence = 'MEDIUM';
        else if (withIqd.length === 1)
            confidence = 'LOW';
        const comparable = withIqd.length > 0;
        let reason;
        if (comparable) {
            reason = `${withIqd.length} reconciled withdrawal(s) with a known economic dinar cost.`;
        }
        else if (reconciled.length > 0) {
            reason =
                `${reconciled.length} reconciled withdrawal(s), but this ${e.card.nativeCurrency} card has no funding ` +
                    'record, so its real dinar cost is unknown and it cannot be compared on cost.';
        }
        else if (e.observations.length > 0) {
            reason = `${e.observations.length} withdrawal(s) recorded, none yet reconciled.`;
        }
        else {
            reason = 'No withdrawals recorded for this card.';
        }
        return {
            card: e.card,
            averageIqdPerSar,
            lastSettledIqdPerSar: lastWithIqd?.iqdPerSar ?? null,
            averageNativePerSar,
            sampleCount: e.observations.length,
            usableSampleCount: withIqd.length,
            confidence,
            comparable,
            reason,
        };
    });
    const comparable = rankings.filter((r) => r.comparable && r.averageIqdPerSar);
    const notComparable = rankings.filter((r) => !r.comparable || !r.averageIqdPerSar);
    comparable.sort((a, b) => compareRates(a.averageIqdPerSar, b.averageIqdPerSar));
    const best = comparable[0] ?? null;
    const message = comparable.length === 0
        ? 'Insufficient settled transactions for reliable recommendation.'
        : best && best.confidence === 'LOW'
            ? 'Ranking is based on a single settled withdrawal per card. Treat it as provisional.'
            : 'Ranking is based on reconciled withdrawals only.';
    return { ranked: comparable, notComparable, best, message };
}
/** Expected cost of a target SAR amount on a card, from evidence only. */
export function expectedCostOf(ranking, targetSar) {
    if (targetSar.currency !== 'SAR') {
        throw new TypeError(`Target must be SAR, received ${targetSar.currency}`);
    }
    if (!ranking.averageIqdPerSar) {
        return unknown(`No verified economic rate for ${ranking.card.nickname}: ${ranking.reason}`, ranking.card.nativeCurrency === 'IQD'
            ? ['A reconciled withdrawal on this card']
            : ['A funding record for this card', 'A reconciled withdrawal on this card']);
    }
    const conf = ranking.confidence === 'HIGH' ? 'VERIFIED' : 'POSTED';
    return known(convert(targetSar, ranking.averageIqdPerSar), 'DERIVED_CALCULATION', conf, `Average of ${ranking.usableSampleCount} reconciled withdrawal(s) on ${ranking.card.nickname}.`);
}
export function buildComparison(evidence, extras) {
    const { ranked, notComparable } = rankCards(evidence);
    const all = [...ranked, ...notComparable];
    return all.map((r) => {
        const ev = evidence.find((e) => e.card.id === r.card.id);
        const reconciled = (ev?.observations ?? []).filter((o) => o.isReconciled);
        const sorted = [...reconciled].sort((a, b) => (a.transactionAt < b.transactionAt ? 1 : -1));
        const extra = extras.get(r.card.id);
        return {
            card: r.card,
            nativeCurrency: r.card.nativeCurrency,
            lastSettledNativePerSar: sorted[0]?.nativePerSar ?? null,
            rollingAverageNativePerSar: r.averageNativePerSar,
            lastSettledIqdPerSar: r.lastSettledIqdPerSar,
            rollingAverageIqdPerSar: r.averageIqdPerSar,
            totalFeesNative: extra?.totalFeesNative ?? zero(r.card.nativeCurrency),
            sampleCount: r.sampleCount,
            dccUsedCount: extra?.dccUsedCount ?? 0,
            atmOperators: extra?.atmOperators ?? [],
            confidence: r.confidence,
            comparableInIqd: r.comparable,
        };
    });
}
export function sarAmount(whole) {
    return majorUnits(whole, 'SAR');
}
export function totalFees(fees, currency) {
    return sum(fees, currency);
}
