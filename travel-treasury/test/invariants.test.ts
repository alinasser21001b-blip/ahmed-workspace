import { describe, expect, it } from 'vitest';
import { add, CurrencyMismatchError, fromDecimalString, toDecimalString, majorUnits, percentOf, subtract } from '../src/core/money.ts';
import { computeWithdrawal } from '../src/core/withdrawal.ts';
import { reconcileWithdrawal } from '../src/core/reconcile.ts';
import { movementForWithdrawal, OwnershipLeakError, assertOwnershipMatch, treasurySummary, walletPosition } from '../src/core/treasury.ts';
import { convert, effectiveRate, rateFromDecimal } from '../src/core/rate.ts';
import { estimateFees, resolveRules, type FeeRule } from '../src/core/fees.ts';
import { assertTransition, IllegalTransitionError, canTransition } from '../src/core/states.ts';
import { balance, card, iqd, sar, usd, withdrawal } from './helpers.ts';

describe('INVARIANT: money never changes currency without an explicit conversion basis', () => {
  it('refuses to add different currencies', () => {
    expect(() => add(iqd(1000), sar(10))).toThrow(CurrencyMismatchError);
  });
  it('refuses to subtract different currencies', () => {
    expect(() => subtract(usd(10), iqd(10))).toThrow(CurrencyMismatchError);
  });
  it('refuses to apply a rate for the wrong pair', () => {
    const r = rateFromDecimal('348.30', 'SAR', 'IQD');
    expect(() => convert(usd(100), r)).toThrow(/explicit conversion basis/);
  });
  it('refuses to treat a USD card as an IQD card', () => {
    const usdCard = card({ nativeCurrency: 'USD' });
    expect(() =>
      computeWithdrawal(withdrawal({ card: usdCard, before: balance(iqd(3000)), after: balance(iqd(2730)) })),
    ).toThrow(/must not be treated as/);
  });
});

describe('INVARIANT: no floating point in money', () => {
  it('rejects a fractional JavaScript number', () => {
    expect(() => majorUnits(10.5, 'SAR')).toThrow();
  });
  it('parses decimals exactly where binary floats cannot', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Here it is exact.
    const a = fromDecimalString('0.1', 'SAR');
    const b = fromDecimalString('0.2', 'SAR');
    expect(toDecimalString(add(a, b))).toBe('0.30');
  });
  it('computes percentages exactly', () => {
    // 2% of 1,000.05 SAR = 20.001 -> 20.00 with HALF_UP at 2dp.
    expect(toDecimalString(percentOf(fromDecimalString('1000.05', 'SAR'), '2'))).toBe('20.00');
    // 2.5% of 5,000,000 IQD = 125,000 exactly.
    expect(toDecimalString(percentOf(iqd(5_000_000), '2.5'))).toBe('125000');
  });
  it('rejects excess precision rather than silently rounding it away', () => {
    expect(() => fromDecimalString('10.005', 'SAR')).toThrow(/decimal place/);
    expect(() => fromDecimalString('10.5', 'IQD')).toThrow(/decimal place/);
  });
  it('keeps an inexact effective rate exact as a ratio', () => {
    // 1,857,100 IQD over 5,000 SAR = 371.42 exactly; a third would not be.
    const r = effectiveRate(iqd(1_857_100), sar(5000));
    expect(r).not.toBeNull();
    expect(r!.num * 100n).toBe(37142n * r!.den);
  });
});

describe('INVARIANT: actual SAR dispensed cannot be negative', () => {
  it('rejects a negative dispense in the engine', () => {
    expect(() => computeWithdrawal(withdrawal({ dispensedSar: { minor: -1n, currency: 'SAR' } }))).toThrow(
      /cannot be negative/,
    );
  });
  it('rejects a negative dispense in the treasury', () => {
    expect(() =>
      movementForWithdrawal({
        withdrawalId: 'w',
        cardOwnership: 'PERSONAL',
        dispensedSar: { minor: -100n, currency: 'SAR' },
        occurredAt: '2026-09-02T09:00:00Z',
      }),
    ).toThrow(/cannot be negative/);
  });
});

describe('INVARIANT: a failed dispense cannot increase the cash treasury', () => {
  it('produces no movement at all', () => {
    expect(
      movementForWithdrawal({
        withdrawalId: 'w',
        cardOwnership: 'COMPANY',
        dispensedSar: sar(0),
        occurredAt: '2026-09-02T09:00:00Z',
      }),
    ).toBeNull();
  });
  it('leaves both wallets empty', () => {
    const movements = [
      movementForWithdrawal({ withdrawalId: 'a', cardOwnership: 'COMPANY', dispensedSar: sar(0), occurredAt: 'x' }),
      movementForWithdrawal({ withdrawalId: 'b', cardOwnership: 'PERSONAL', dispensedSar: sar(0), occurredAt: 'x' }),
    ].filter((m) => m !== null);
    const t = treasurySummary(movements);
    expect(t.totalReceived.minor).toBe(0n);
  });
});

describe('INVARIANT: company withdrawals never enter the personal wallet, and vice versa', () => {
  const companyMove = movementForWithdrawal({
    withdrawalId: 'w_co',
    cardOwnership: 'COMPANY',
    dispensedSar: sar(5000),
    occurredAt: '2026-09-02T09:00:00Z',
  })!;
  const personalMove = movementForWithdrawal({
    withdrawalId: 'w_pe',
    cardOwnership: 'PERSONAL',
    dispensedSar: sar(1000),
    occurredAt: '2026-09-02T10:00:00Z',
  })!;

  it('routes a company withdrawal to the company wallet only', () => {
    const t = treasurySummary([companyMove, personalMove]);
    expect(toDecimalString(t.company.received)).toBe('5000.00');
    expect(toDecimalString(t.personal.received)).toBe('1000.00');
  });

  it('rejects a movement whose ownership disagrees with its source', () => {
    expect(() => assertOwnershipMatch(companyMove, 'PERSONAL')).toThrow(OwnershipLeakError);
  });

  it('never lets a personal figure appear in a company total', () => {
    const company = walletPosition('COMPANY', [companyMove, personalMove]);
    expect(company.movementCount).toBe(1);
    expect(toDecimalString(company.expectedOnHand)).toBe('5000.00');
  });

  it('describes a company withdrawal as a transfer, not an expense', () => {
    expect(companyMove.kind).toBe('ATM_WITHDRAWAL');
    expect(companyMove.notes).toMatch(/not an expense/);
  });
});

describe('INVARIANT: a reconciled transaction contains no unexplained difference', () => {
  it('will not report reconciled while a difference remains', () => {
    const w = withdrawal({
      before: balance(iqd(5_000_000)),
      after: balance(iqd(4_600_000), { source: 'STATEMENT', balanceType: 'LEDGER' }),
      posted: { debit: iqd(388_000), postedAt: '2026-09-04T00:00:00Z' },
    });
    const r = reconcileWithdrawal(w, computeWithdrawal(w));
    expect(r.isReconciled).toBe(false);
    expect(r.difference.known && r.difference.value.minor !== 0n).toBe(true);
  });

  it('reports reconciled only on a posted basis with a zero difference', () => {
    const w = withdrawal({
      before: balance(iqd(5_000_000)),
      after: balance(iqd(4_612_000), { source: 'STATEMENT', balanceType: 'LEDGER' }),
      posted: { debit: iqd(388_000), postedAt: '2026-09-04T00:00:00Z' },
    });
    const r = reconcileWithdrawal(w, computeWithdrawal(w));
    expect(r.isReconciled).toBe(true);
  });

  it('is only PARTIALLY_RECONCILED when the cost is not yet posted', () => {
    const w = withdrawal({
      before: balance(iqd(5_000_000)),
      after: balance(iqd(4_612_000)),
    });
    const r = reconcileWithdrawal(w, computeWithdrawal(w));
    expect(r.isReconciled).toBe(false);
    expect(r.suggestedState).toBe('PARTIALLY_RECONCILED');
  });
});

describe('INVARIANT: historical fee rules do not change when the tariff changes', () => {
  const oldRule: FeeRule = {
    id: 'r_old', issuer: 'NEO Iraq', product: 'NEO 964', ruleType: 'ATM_WITHDRAWAL_FEE',
    transactionType: 'ATM_WITHDRAWAL', region: 'CEMEA', amount: iqd(3000), currency: 'IQD',
    effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', sourceId: 'S2', confidence: 'LIKELY',
  };
  const newRule: FeeRule = {
    ...oldRule, id: 'r_new', amount: iqd(6000), effectiveFrom: '2026-07-01', effectiveTo: null,
  };
  const rules = [oldRule, newRule];
  const q = {
    issuer: 'NEO Iraq', product: 'NEO 964', transactionType: 'ATM_WITHDRAWAL' as const,
    region: 'CEMEA' as const, onDate: '',
  };

  it('prices a June transaction at the June tariff even after July publishes a new one', () => {
    const june = estimateFees(rules, { ...q, onDate: '2026-06-15' }, iqd(1_000_000));
    if (!june.total.known || june.total.value.kind !== 'EXACT') throw new Error('expected exact');
    expect(toDecimalString(june.total.value.amount)).toBe('3000');
  });

  it('prices a July transaction at the July tariff', () => {
    const july = estimateFees(rules, { ...q, onDate: '2026-07-15' }, iqd(1_000_000));
    if (!july.total.known || july.total.value.kind !== 'EXACT') throw new Error('expected exact');
    expect(toDecimalString(july.total.value.amount)).toBe('6000');
  });

  it('never applies two overlapping versions of the same rule at once', () => {
    expect(resolveRules(rules, { ...q, onDate: '2026-06-15' })).toHaveLength(1);
    expect(resolveRules(rules, { ...q, onDate: '2026-07-15' })).toHaveLength(1);
  });

  it('never applies a NEO 964 rule to a NEO Platinum card', () => {
    const applied = resolveRules(rules, { ...q, product: 'NEO Platinum', onDate: '2026-06-15' });
    expect(applied).toHaveLength(0);
  });
});

describe('INVARIANT: a reversal does not delete the original financial event', () => {
  it('keeps both postings computable and independently addressable', () => {
    const original = withdrawal({ id: 'orig', posted: { debit: iqd(1_900_000), postedAt: '2026-09-03T00:00:00Z' }, dispensedSar: sar(0) });
    const reversal = withdrawal({ id: 'rev', posted: { debit: iqd(-1_900_000), postedAt: '2026-09-05T00:00:00Z' }, dispensedSar: sar(0) });
    const a = computeWithdrawal(original);
    const b = computeWithdrawal(reversal);
    expect(a.postedDebitTotal.known).toBe(true);
    expect(b.postedDebitTotal.known).toBe(true);
    expect(original.id).not.toBe(reversal.id);
  });
});

describe('INVARIANT: illegal state transitions are rejected, not coerced', () => {
  it('allows DRAFT -> CAPTURED', () => {
    expect(canTransition('DRAFT', 'CAPTURED')).toBe(true);
  });
  it('rejects DRAFT -> RECONCILED', () => {
    expect(() => assertTransition('DRAFT', 'RECONCILED')).toThrow(IllegalTransitionError);
  });
  it('lets a failed ATM still settle and reverse', () => {
    expect(canTransition('FAILED_ATM', 'POSTED')).toBe(true);
    expect(canTransition('FAILED_ATM', 'REVERSED')).toBe(true);
  });
  it('lets a partial dispense continue to settlement', () => {
    expect(canTransition('PARTIAL_DISPENSE', 'POSTED')).toBe(true);
  });
});
