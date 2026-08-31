import { describe, expect, it } from 'vitest';
import { computeWithdrawal, fundingBasisFrom } from '../src/core/withdrawal.ts';
import { reconcileWithdrawal } from '../src/core/reconcile.ts';
import { movementForWithdrawal, treasurySummary } from '../src/core/treasury.ts';
import { findDuplicates, highestRisk } from '../src/core/duplicate.ts';
import { rateToDecimalString, rateFromDecimal } from '../src/core/rate.ts';
import { toDecimalString, equals } from '../src/core/money.ts';
import { balance, card, iqd, sar, usd, withdrawal } from './helpers.ts';

/**
 * The scenarios named in the specification, computed exactly.
 */
describe('Scenario: IQD card, observed balance delta', () => {
  const w = withdrawal({
    before: balance(iqd(5_000_000)),
    after: balance(iqd(4_612_000), { capturedAt: '2026-09-02T09:07:00Z' }),
    dispensedSar: sar(1000),
  });
  const c = computeWithdrawal(w);

  it('observes a 388,000 IQD delta', () => {
    expect(c.observedBalanceDelta.known).toBe(true);
    if (!c.observedBalanceDelta.known) throw new Error('unreachable');
    expect(toDecimalString(c.observedBalanceDelta.value)).toBe('388000');
    expect(c.observedBalanceDelta.confidence).toBe('OBSERVED');
  });

  it('derives exactly 388 IQD per SAR', () => {
    expect(c.effectiveNativePerSar.known).toBe(true);
    if (!c.effectiveNativePerSar.known) throw new Error('unreachable');
    expect(rateToDecimalString(c.effectiveNativePerSar.value, 4)).toBe('388.0000');
    expect(c.effectiveNativePerSar.value.to).toBe('IQD');
    expect(c.effectiveNativePerSar.value.from).toBe('SAR');
  });

  it('labels the basis as observed, not posted', () => {
    expect(c.costBasis).toBe('OBSERVED');
  });

  it('warns that an AVAILABLE balance may not be final', () => {
    expect(c.warnings.map((w) => w.text).join(" ")).toMatch(/AVAILABLE/);
  });

  it('treats an IQD card economic cost as the native cost', () => {
    expect(c.economicIqdCost.known).toBe(true);
    if (!c.economicIqdCost.known) throw new Error('unreachable');
    expect(toDecimalString(c.economicIqdCost.value)).toBe('388000');
  });
});

describe('Scenario: separately posted fee', () => {
  const w = withdrawal({
    dispensedSar: sar(1000),
    posted: {
      debit: iqd(380_000),
      cashWithdrawalFee: iqd(8_000),
      postedAt: '2026-09-04T10:00:00Z',
      statementDescription: 'ATM WDL RIYADH',
    },
  });
  const c = computeWithdrawal(w);

  it('keeps the posted debit and the fee separate', () => {
    if (!c.postedDebitTotal.known || !c.issuerFees.known) throw new Error('expected known');
    expect(toDecimalString(c.postedDebitTotal.value)).toBe('380000');
    expect(toDecimalString(c.issuerFees.value)).toBe('8000');
  });

  it('produces an all-in cost of 388,000 IQD', () => {
    if (!c.nativeAllInCost.known) throw new Error('expected known');
    expect(toDecimalString(c.nativeAllInCost.value)).toBe('388000');
    expect(c.costBasis).toBe('POSTED');
  });

  it('produces an effective rate of 388 IQD per SAR', () => {
    if (!c.effectiveNativePerSar.known) throw new Error('expected known');
    expect(rateToDecimalString(c.effectiveNativePerSar.value, 2)).toBe('388.00');
    expect(c.effectiveNativePerSar.confidence).toBe('POSTED');
  });
});

describe('Scenario: pending versus posted', () => {
  const w = withdrawal({
    dispensedSar: sar(1000),
    pending: { debit: iqd(382_000), at: '2026-09-02T09:10:00Z', description: 'PENDING ATM' },
    posted: { debit: iqd(387_250), postedAt: '2026-09-04T10:00:00Z' },
  });
  const c = computeWithdrawal(w);

  it('preserves both figures independently', () => {
    if (!c.pendingDebitTotal.known || !c.postedDebitTotal.known) throw new Error('expected known');
    expect(toDecimalString(c.pendingDebitTotal.value)).toBe('382000');
    expect(toDecimalString(c.postedDebitTotal.value)).toBe('387250');
  });

  it('costs the withdrawal on the posted figure, not the pending one', () => {
    if (!c.nativeAllInCost.known) throw new Error('expected known');
    expect(toDecimalString(c.nativeAllInCost.value)).toBe('387250');
    expect(c.costBasis).toBe('POSTED');
  });

  it('labels the pending figure as PENDING confidence', () => {
    if (!c.pendingDebitTotal.known) throw new Error('expected known');
    expect(c.pendingDebitTotal.confidence).toBe('PENDING');
  });
});

describe('Scenario: USD card without a funding basis', () => {
  const usdCard = card({
    id: 'card_neo_platinum',
    nickname: 'NEO Platinum',
    product: 'NEO Platinum',
    nativeCurrency: 'USD',
  });
  const w = withdrawal({
    card: usdCard,
    before: balance(usd(3000)),
    after: balance(usd(2730)),
    dispensedSar: sar(1000),
  });
  const c = computeWithdrawal(w);

  it('observes a native cost of 270 USD', () => {
    if (!c.nativeAllInCost.known) throw new Error('expected known');
    expect(toDecimalString(c.nativeAllInCost.value)).toBe('270.00');
    expect(c.nativeAllInCost.value.currency).toBe('USD');
  });

  it('REFUSES to declare an economic IQD cost', () => {
    expect(c.economicIqdCost.known).toBe(false);
    if (c.economicIqdCost.known) throw new Error('unreachable');
    expect(c.economicIqdCost.reason).toMatch(/Not enough evidence/);
    expect(c.economicIqdCost.missing.join(' ')).toMatch(/funding/i);
  });

  it('refuses a verified IQD/SAR rate as well', () => {
    expect(c.verifiedIqdPerSar.known).toBe(false);
  });

  it('will produce a clearly-labelled reference cost when a reference rate exists', () => {
    const withRef = computeWithdrawal(w, {
      referenceRate: rateFromDecimal('1310', 'USD', 'IQD'),
      referenceRateLabel: 'CBI reference 1,310 IQD/USD',
    });
    if (!withRef.referenceIqdCost.known) throw new Error('expected known');
    expect(toDecimalString(withRef.referenceIqdCost.value)).toBe('353700');
    expect(withRef.referenceIqdCost.provenance).toBe('REFERENCE_RATE');
    expect(withRef.referenceIqdCost.basis).toMatch(/NOT what these funds actually cost/);
    // ...and still no economic cost.
    expect(withRef.economicIqdCost.known).toBe(false);
  });

  it('produces an economic cost once funding is recorded, and it differs from the reference', () => {
    const funding = fundingBasisFrom(
      [{ credited: usd(3000), iqdPaid: iqd(3_990_000), occurredAt: '2026-08-20T00:00:00Z' }],
      'USD',
    );
    expect(funding).not.toBeNull();
    const withFunding = computeWithdrawal(w, { funding });
    if (!withFunding.economicIqdCost.known) throw new Error('expected known');
    // 3,990,000 IQD / 3,000 USD = 1,330 IQD per USD; 270 USD => 359,100 IQD
    expect(toDecimalString(withFunding.economicIqdCost.value)).toBe('359100');
    if (!withFunding.verifiedIqdPerSar.known) throw new Error('expected known');
    expect(rateToDecimalString(withFunding.verifiedIqdPerSar.value, 2)).toBe('359.10');
  });
});

describe('Scenario: failed ATM — debited, no cash', () => {
  const w = withdrawal({
    state: 'FAILED_ATM',
    dispensedSar: sar(0),
    requestedSar: sar(5000),
    posted: { debit: iqd(1_900_000), postedAt: '2026-09-03T08:00:00Z' },
  });
  const c = computeWithdrawal(w);

  it('never divides by zero to invent a rate', () => {
    expect(c.effectiveNativePerSar.known).toBe(false);
    if (c.effectiveNativePerSar.known) throw new Error('unreachable');
    expect(c.effectiveNativePerSar.reason).toMatch(/No cash was dispensed/);
  });

  it('still records the money that left the account', () => {
    if (!c.nativeAllInCost.known) throw new Error('expected known');
    expect(toDecimalString(c.nativeAllInCost.value)).toBe('1900000');
  });

  it('does not produce a verified IQD/SAR rate', () => {
    expect(c.verifiedIqdPerSar.known).toBe(false);
  });

  it('cannot credit any cash treasury', () => {
    const m = movementForWithdrawal({
      withdrawalId: w.id,
      cardOwnership: w.card.ownership,
      dispensedSar: w.dispensedSar,
      occurredAt: w.transactionAt,
    });
    expect(m).toBeNull();
  });
});

describe('Scenario: partial dispense', () => {
  const w = withdrawal({
    state: 'PARTIAL_DISPENSE',
    requestedSar: sar(5000),
    dispensedSar: sar(3000),
    posted: { debit: iqd(1_164_000), postedAt: '2026-09-03T08:00:00Z' },
  });
  const c = computeWithdrawal(w);

  it('costs against cash actually dispensed, not cash requested', () => {
    if (!c.effectiveNativePerSar.known) throw new Error('expected known');
    // 1,164,000 / 3,000 = 388 exactly. Against 5,000 it would have been 232.8.
    expect(rateToDecimalString(c.effectiveNativePerSar.value, 2)).toBe('388.00');
  });

  it('warns that requested and dispensed differ', () => {
    expect(c.warnings.map((w) => w.text).join(" ")).toMatch(/Requested and dispensed cash differ/);
  });

  it('credits the treasury with the cash actually received', () => {
    const m = movementForWithdrawal({
      withdrawalId: w.id,
      cardOwnership: 'PERSONAL',
      dispensedSar: w.dispensedSar,
      occurredAt: w.transactionAt,
    });
    expect(m).not.toBeNull();
    expect(equals(m!.amount, sar(3000))).toBe(true);
  });
});

describe('Scenario: reversal preserves both events', () => {
  it('nets to zero cost while keeping the original debit visible', () => {
    const original = withdrawal({
      id: 'w_orig',
      state: 'REVERSED',
      dispensedSar: sar(0),
      posted: { debit: iqd(1_900_000), postedAt: '2026-09-03T08:00:00Z' },
    });
    const reversal = withdrawal({
      id: 'w_rev',
      state: 'REVERSED',
      dispensedSar: sar(0),
      posted: { debit: iqd(-1_900_000), postedAt: '2026-09-05T08:00:00Z' },
    });
    const a = computeWithdrawal(original);
    const b = computeWithdrawal(reversal);
    if (!a.nativeAllInCost.known || !b.nativeAllInCost.known) throw new Error('expected known');

    expect(toDecimalString(a.nativeAllInCost.value)).toBe('1900000');
    expect(toDecimalString(b.nativeAllInCost.value)).toBe('-1900000');
    const net = a.nativeAllInCost.value.minor + b.nativeAllInCost.value.minor;
    expect(net).toBe(0n);
  });
});

describe('Scenario: duplicate entry detection', () => {
  const existing = [
    {
      id: 'w_first',
      cardId: 'card_neo964',
      dispensedSar: sar(1000),
      transactionAt: '2026-09-02T09:05:00Z',
      atmTerminalId: 'RUH-0042',
      atmOperator: 'Al Rajhi',
    },
  ];

  it('flags a same-card, same-amount, same-terminal repeat as high risk', () => {
    const findings = findDuplicates(
      {
        cardId: 'card_neo964',
        dispensedSar: sar(1000),
        transactionAt: '2026-09-02T09:06:30Z',
        atmTerminalId: 'RUH-0042',
        atmOperator: 'Al Rajhi',
      },
      existing,
    );
    expect(findings).toHaveLength(1);
    expect(highestRisk(findings)).toBe('HIGH');
  });

  it('treats a matching transaction reference as certain', () => {
    const findings = findDuplicates(
      {
        cardId: 'card_neo964',
        dispensedSar: sar(1000),
        transactionAt: '2026-09-02T23:00:00Z',
        transactionReference: 'REF-9931',
      },
      [{ ...existing[0]!, transactionReference: 'REF-9931' }],
    );
    expect(highestRisk(findings)).toBe('CERTAIN');
  });

  it('does not flag a different card', () => {
    const findings = findDuplicates(
      {
        cardId: 'card_other',
        dispensedSar: sar(1000),
        transactionAt: '2026-09-02T09:06:00Z',
      },
      existing,
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag a genuine second withdrawal hours later', () => {
    const findings = findDuplicates(
      {
        cardId: 'card_neo964',
        dispensedSar: sar(1000),
        transactionAt: '2026-09-02T15:05:00Z',
      },
      existing,
    );
    expect(findings).toHaveLength(0);
  });
});

describe('Scenario: reconciliation surfaces a separately posted fee', () => {
  const w = withdrawal({
    before: balance(iqd(5_000_000)),
    after: balance(iqd(4_612_000), { source: 'STATEMENT', balanceType: 'LEDGER' }),
    dispensedSar: sar(1000),
    posted: { debit: iqd(380_000), postedAt: '2026-09-04T10:00:00Z' },
  });
  const c = computeWithdrawal(w);
  const r = reconcileWithdrawal(w, c);

  it('detects the 8,000 IQD that the posted debit alone does not explain', () => {
    if (!r.difference.known) throw new Error('expected known');
    expect(toDecimalString(r.difference.value)).toBe('-8000');
    expect(r.isReconciled).toBe(false);
  });

  it('proposes a separately posted issuer fee as a leading cause', () => {
    expect(r.potentialCauses.map((p) => p.cause)).toContain('SEPARATE_ISSUER_FEE');
  });

  it('never resolves the discrepancy by itself', () => {
    expect(r.suggestedState).toBe('DISCREPANCY');
    expect(r.explanation).toMatch(/classified by a person/);
  });

  it('reconciles once the fee is recorded', () => {
    const fixed = { ...w, posted: { ...w.posted!, cashWithdrawalFee: iqd(8_000) } };
    const c2 = computeWithdrawal(fixed);
    const r2 = reconcileWithdrawal(fixed, c2);
    expect(r2.isReconciled).toBe(true);
    expect(r2.suggestedState).toBe('RECONCILED');
  });
});
