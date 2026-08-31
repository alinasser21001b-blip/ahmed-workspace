import type { CurrencyCode } from './currency.ts';
import { type Money, majorUnits, sum, zero } from './money.ts';
import { compareRates, convert, meanRate, type Rate } from './rate.ts';
import { type Evidenced, known, type PricingConfidence, unknown } from './evidence.ts';
import type { CardRef } from './withdrawal.ts';

/**
 * One settled data point for a card: what a withdrawal actually cost, per SAR.
 *
 * `iqdPerSar` is the *economic* rate — the real dinar cost. It is present only
 * where the evidence supports it (an IQD card, or a USD card with a funding
 * basis), which is why it is separate from the native rate.
 */
export interface SettledObservation {
  readonly withdrawalId: string;
  readonly transactionAt: string;
  readonly nativePerSar: Rate;
  readonly iqdPerSar: Rate | null;
  readonly dispensedSar: Money;
  readonly confidence: PricingConfidence;
  readonly isReconciled: boolean;
}

export interface CardEvidence {
  readonly card: CardRef;
  readonly observations: readonly SettledObservation[];
}

export type RecommendationConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface CardRanking {
  readonly card: CardRef;
  /** Economic IQD per SAR, averaged over usable observations. Null when not knowable. */
  readonly averageIqdPerSar: Rate | null;
  readonly lastSettledIqdPerSar: Rate | null;
  readonly averageNativePerSar: Rate | null;
  readonly sampleCount: number;
  readonly usableSampleCount: number;
  readonly confidence: RecommendationConfidence;
  readonly comparable: boolean;
  readonly reason: string;
}

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
export function rankCards(evidence: readonly CardEvidence[]): {
  readonly ranked: readonly CardRanking[];
  readonly notComparable: readonly CardRanking[];
  readonly best: CardRanking | null;
  readonly message: string;
} {
  const rankings: CardRanking[] = evidence.map((e) => {
    const reconciled = e.observations.filter((o) => o.isReconciled && o.confidence === 'RECONCILED');
    const withIqd = reconciled.filter((o) => o.iqdPerSar !== null);
    const sorted = [...reconciled].sort((a, b) => (a.transactionAt < b.transactionAt ? 1 : -1));

    const averageNativePerSar = meanRate(reconciled.map((o) => o.nativePerSar));
    const averageIqdPerSar = meanRate(withIqd.map((o) => o.iqdPerSar as Rate));
    const lastWithIqd = sorted.find((o) => o.iqdPerSar !== null);

    let confidence: RecommendationConfidence = 'NONE';
    if (withIqd.length >= MIN_SAMPLES_FOR_HIGH) confidence = 'HIGH';
    else if (withIqd.length >= MIN_SAMPLES_FOR_MEDIUM) confidence = 'MEDIUM';
    else if (withIqd.length === 1) confidence = 'LOW';

    const comparable = withIqd.length > 0;
    let reason: string;
    if (comparable) {
      reason = `${withIqd.length} reconciled withdrawal(s) with a known economic dinar cost.`;
    } else if (reconciled.length > 0) {
      reason =
        `${reconciled.length} reconciled withdrawal(s), but this ${e.card.nativeCurrency} card has no funding ` +
        'record, so its real dinar cost is unknown and it cannot be compared on cost.';
    } else if (e.observations.length > 0) {
      reason = `${e.observations.length} withdrawal(s) recorded, none yet reconciled.`;
    } else {
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

  comparable.sort((a, b) => compareRates(a.averageIqdPerSar as Rate, b.averageIqdPerSar as Rate));

  const best = comparable[0] ?? null;
  const message =
    comparable.length === 0
      ? 'Insufficient settled transactions for reliable recommendation.'
      : best && best.confidence === 'LOW'
        ? 'Ranking is based on a single settled withdrawal per card. Treat it as provisional.'
        : 'Ranking is based on reconciled withdrawals only.';

  return { ranked: comparable, notComparable, best, message };
}

/** Expected cost of a target SAR amount on a card, from evidence only. */
export function expectedCostOf(
  ranking: CardRanking,
  targetSar: Money,
): Evidenced<Money> {
  if (targetSar.currency !== 'SAR') {
    throw new TypeError(`Target must be SAR, received ${targetSar.currency}`);
  }
  if (!ranking.averageIqdPerSar) {
    return unknown(
      `No verified economic rate for ${ranking.card.nickname}: ${ranking.reason}`,
      ranking.card.nativeCurrency === 'IQD'
        ? ['A reconciled withdrawal on this card']
        : ['A funding record for this card', 'A reconciled withdrawal on this card'],
    );
  }
  const conf: PricingConfidence = ranking.confidence === 'HIGH' ? 'VERIFIED' : 'POSTED';
  return known(
    convert(targetSar, ranking.averageIqdPerSar),
    'DERIVED_CALCULATION',
    conf,
    `Average of ${ranking.usableSampleCount} reconciled withdrawal(s) on ${ranking.card.nickname}.`,
  );
}

/** Comparison row for the card comparison view. */
export interface ComparisonRow {
  readonly card: CardRef;
  readonly nativeCurrency: CurrencyCode;
  readonly lastSettledNativePerSar: Rate | null;
  readonly rollingAverageNativePerSar: Rate | null;
  readonly lastSettledIqdPerSar: Rate | null;
  readonly rollingAverageIqdPerSar: Rate | null;
  readonly totalFeesNative: Money;
  readonly sampleCount: number;
  readonly dccUsedCount: number;
  readonly atmOperators: readonly string[];
  readonly confidence: RecommendationConfidence;
  readonly comparableInIqd: boolean;
}

export function buildComparison(
  evidence: readonly CardEvidence[],
  extras: ReadonlyMap<string, { totalFeesNative: Money; dccUsedCount: number; atmOperators: string[] }>,
): readonly ComparisonRow[] {
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

export function sarAmount(whole: number): Money {
  return majorUnits(whole, 'SAR');
}

export function totalFees(fees: readonly Money[], currency: CurrencyCode): Money {
  return sum(fees, currency);
}
