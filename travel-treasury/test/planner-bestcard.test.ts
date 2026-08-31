import { describe, expect, it } from 'vitest';
import { planWithdrawals, type PlannerCard } from '../src/core/planner.ts';
import { rankCards, expectedCostOf, type CardEvidence, type SettledObservation } from '../src/core/bestcard.ts';
import { rateFromDecimal, rateToDecimalString, effectiveRate } from '../src/core/rate.ts';
import { toDecimalString } from '../src/core/money.ts';
import { card, iqd, sar, usd } from './helpers.ts';

const neo964 = card({ id: 'neo964', nickname: 'NEO 964', product: 'NEO 964', nativeCurrency: 'IQD', internationalStatus: 'CONFIRMED_WORKING' });
const nbi = card({ id: 'nbi', nickname: 'NBI', issuer: 'National Bank of Iraq', product: 'NBI Debit', nativeCurrency: 'IQD', internationalStatus: 'CONFIRMED_WORKING' });
const qi = card({ id: 'qi', nickname: 'Rafidain Qi (company)', issuer: 'Rafidain Bank / Qi Card', product: 'Qi Mastercard', network: 'MASTERCARD', ownership: 'COMPANY', nativeCurrency: 'IQD', internationalStatus: 'RESTRICTED_BY_REGULATION' });
const neoUsd = card({ id: 'neousd', nickname: 'NEO Platinum', product: 'NEO Platinum', nativeCurrency: 'USD', internationalStatus: 'CONFIRMED_WORKING' });

function obs(nativePerSar: string, cur: 'IQD' | 'USD', iqdPerSar: string | null, at: string): SettledObservation {
  return {
    withdrawalId: `w_${at}`,
    transactionAt: at,
    nativePerSar: rateFromDecimal(nativePerSar, 'SAR', cur),
    iqdPerSar: iqdPerSar ? rateFromDecimal(iqdPerSar, 'SAR', 'IQD') : null,
    dispensedSar: sar(1000),
    confidence: 'RECONCILED',
    isReconciled: true,
  };
}

describe('Best Card engine', () => {
  it('says so plainly when there is not enough settled data', () => {
    const r = rankCards([{ card: neo964, observations: [] }]);
    expect(r.best).toBeNull();
    expect(r.message).toBe('Insufficient settled transactions for reliable recommendation.');
  });

  it('ignores unreconciled withdrawals', () => {
    const evidence: CardEvidence[] = [
      {
        card: neo964,
        observations: [
          { ...obs('388', 'IQD', '388', '2026-09-01'), isReconciled: false, confidence: 'POSTED' },
        ],
      },
    ];
    const r = rankCards(evidence);
    expect(r.best).toBeNull();
  });

  it('ranks cheapest-first on reconciled economic rates', () => {
    const evidence: CardEvidence[] = [
      { card: neo964, observations: [obs('371.4', 'IQD', '371.4', '2026-09-01'), obs('371.5', 'IQD', '371.5', '2026-09-02'), obs('371.3', 'IQD', '371.3', '2026-09-03')] },
      { card: nbi, observations: [obs('388', 'IQD', '388', '2026-09-01'), obs('388', 'IQD', '388', '2026-09-02'), obs('388', 'IQD', '388', '2026-09-03')] },
    ];
    const r = rankCards(evidence);
    expect(r.best?.card.id).toBe('neo964');
    expect(r.best?.confidence).toBe('HIGH');
    expect(rateToDecimalString(r.best!.averageIqdPerSar!, 2)).toBe('371.40');
  });

  it('estimates the cost of a target amount from evidence only', () => {
    const evidence: CardEvidence[] = [
      { card: neo964, observations: [obs('371.4', 'IQD', '371.4', '2026-09-01'), obs('371.4', 'IQD', '371.4', '2026-09-02'), obs('371.4', 'IQD', '371.4', '2026-09-03')] },
    ];
    const r = rankCards(evidence);
    const cost = expectedCostOf(r.best!, sar(5000));
    if (!cost.known) throw new Error('expected known');
    expect(toDecimalString(cost.value)).toBe('1857000');
    expect(cost.confidence).toBe('VERIFIED');
  });

  it('does NOT mix a USD card native rate into the IQD ranking', () => {
    const evidence: CardEvidence[] = [
      { card: neo964, observations: [obs('388', 'IQD', '388', '2026-09-01')] },
      // USD card, reconciled, but no economic IQD basis.
      { card: neoUsd, observations: [obs('0.27', 'USD', null, '2026-09-01')] },
    ];
    const r = rankCards(evidence);
    expect(r.ranked.map((x) => x.card.id)).toEqual(['neo964']);
    expect(r.notComparable.map((x) => x.card.id)).toEqual(['neousd']);
    expect(r.notComparable[0]!.reason).toMatch(/no funding record/);
  });

  it('refuses to quote a cost for a card it cannot price', () => {
    const r = rankCards([{ card: neoUsd, observations: [obs('0.27', 'USD', null, '2026-09-01')] }]);
    const cost = expectedCostOf(r.notComparable[0]!, sar(5000));
    expect(cost.known).toBe(false);
  });
});

describe('Withdrawal planner', () => {
  const base: PlannerCard[] = [
    {
      card: neo964,
      availableNative: iqd(3_000_000),
      dailyAtmLimit: iqd(2_000_000),
      perTransactionLimit: iqd(900_000),
      verifiedNativePerSar: rateFromDecimal('371.4', 'SAR', 'IQD'),
    },
    {
      card: nbi,
      availableNative: iqd(5_000_000),
      dailyAtmLimit: iqd(4_000_000),
      verifiedNativePerSar: rateFromDecimal('388', 'SAR', 'IQD'),
    },
  ];

  it('allocates cheapest verified card first', () => {
    const plan = planWithdrawals(sar(12_000), base);
    expect(plan.allocations[0]!.card.id).toBe('neo964');
    expect(plan.allocations.length).toBeGreaterThan(0);
  });

  it('respects the daily limit as a binding constraint', () => {
    const plan = planWithdrawals(sar(12_000), base);
    const neoAlloc = plan.allocations.find((a) => a.card.id === 'neo964')!;
    // 2,000,000 IQD daily limit / 371.4 = 5,385.03 SAR, rounded down.
    expect(neoAlloc.bindingConstraint).toBe('DAILY_LIMIT');
    expect(Number(neoAlloc.sar.minor)).toBeLessThanOrEqual(538_600);
  });

  it('splits into multiple withdrawals when a per-transaction cap binds', () => {
    const plan = planWithdrawals(sar(12_000), base);
    const neoAlloc = plan.allocations.find((a) => a.card.id === 'neo964')!;
    expect(neoAlloc.withdrawalCount).toBeGreaterThan(1);
    expect(neoAlloc.notes.join(' ')).toMatch(/separate withdrawals/);
  });

  it('reports a shortfall rather than over-allocating', () => {
    const plan = planWithdrawals(sar(50_000), base);
    expect(plan.shortfallSar.minor).toBeGreaterThan(0n);
  });

  it('refuses to plan a card restricted by regulation, and says why', () => {
    const plan = planWithdrawals(sar(5000), [
      ...base,
      { card: qi, availableNative: iqd(10_000_000), verifiedNativePerSar: rateFromDecimal('380', 'SAR', 'IQD') },
    ]);
    const blocked = plan.unusable.find((u) => u.card.id === 'qi');
    expect(blocked).toBeDefined();
    expect(blocked!.reason).toMatch(/restricted for international use/);
  });

  it('refuses to plan a card with no rate at all', () => {
    const plan = planWithdrawals(sar(5000), [{ card: nbi, availableNative: iqd(5_000_000) }]);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.unusable[0]!.reason).toMatch(/No verified or reference rate/);
  });

  it('enforces the CBI regulatory monthly cap independently of bank limits', () => {
    const plan = planWithdrawals(sar(12_000), [
      {
        card: nbi,
        availableNative: iqd(50_000_000),
        dailyAtmLimit: iqd(40_000_000),
        regulatoryMonthlyRemaining: iqd(1_000_000),
        verifiedNativePerSar: rateFromDecimal('388', 'SAR', 'IQD'),
      },
    ]);
    expect(plan.allocations[0]!.bindingConstraint).toBe('REGULATORY_MONTHLY_CAP');
    expect(Number(plan.allocations[0]!.sar.minor)).toBeLessThanOrEqual(257_800);
  });

  it('marks confidence lower when only a reference rate is available', () => {
    const plan = planWithdrawals(sar(1000), [
      { card: nbi, availableNative: iqd(5_000_000), referenceNativePerSar: rateFromDecimal('348.3', 'SAR', 'IQD') },
    ]);
    expect(plan.overallConfidence).toBe('LOW');
    expect(plan.allocations[0]!.rateBasis).toBe('REFERENCE');
  });

  it('refuses a total IQD cost when a non-IQD card is in the plan', () => {
    const plan = planWithdrawals(sar(1000), [
      { card: neoUsd, availableNative: usd(3000), verifiedNativePerSar: rateFromDecimal('0.27', 'SAR', 'USD') },
    ]);
    expect(plan.totalEstimatedCostIqd.known).toBe(false);
  });

  it('always carries the planning disclaimer', () => {
    const plan = planWithdrawals(sar(1000), base);
    expect(plan.disclaimer).toMatch(/planning estimate/);
    expect(plan.disclaimer).toMatch(/تقديرية/);
  });

  it('can restrict a plan to company cards only', () => {
    const plan = planWithdrawals(sar(1000), base, { ownership: 'COMPANY' });
    expect(plan.allocations).toHaveLength(0);
  });

  it('deducts pending amounts from usable balance', () => {
    const plan = planWithdrawals(sar(10_000), [
      {
        card: nbi,
        availableNative: iqd(1_000_000),
        pendingNative: iqd(900_000),
        verifiedNativePerSar: rateFromDecimal('388', 'SAR', 'IQD'),
      },
    ]);
    expect(Number(plan.allocations[0]!.sar.minor)).toBeLessThanOrEqual(25_800);
    expect(plan.allocations[0]!.notes.join(' ')).toMatch(/Pending/);
  });
});
