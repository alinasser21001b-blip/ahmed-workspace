import { describe, expect, it } from 'vitest';
import { computeWithdrawal } from '../src/core/withdrawal.ts';
import { estimateFees } from '../src/core/fees.ts';
import { SEED_FEE_RULES } from '../src/core/research/seed-rules.ts';
import { combine2, known, unknown, expectKnown } from '../src/core/evidence.ts';
import { expectedCashOnHand, walletPosition } from '../src/core/treasury.ts';
import { iqd, sar, card, withdrawal } from './helpers.ts';

/**
 * The product's central promise, tested directly: an absent number is never
 * rendered as zero, and never quietly substituted from somewhere else.
 */
describe('unknown is never zero', () => {
  it('a withdrawal with no evidence yields no cost, not a zero cost', () => {
    const c = computeWithdrawal(withdrawal({ dispensedSar: sar(1000) }));
    expect(c.nativeAllInCost.known).toBe(false);
    expect(c.effectiveNativePerSar.known).toBe(false);
    if (c.nativeAllInCost.known) throw new Error('unreachable');
    expect(c.nativeAllInCost.missing.length).toBeGreaterThan(0);
  });

  it('names exactly what evidence would resolve it', () => {
    const c = computeWithdrawal(withdrawal({ dispensedSar: sar(1000) }));
    if (c.effectiveNativePerSar.known) throw new Error('unreachable');
    expect(c.effectiveNativePerSar.reason).toMatch(/Cannot determine verified effective rate yet/);
  });

  it('an UNKNOWN tariff rule makes the fee total unknown rather than zero', () => {
    const qiRules = SEED_FEE_RULES.filter((r) => r.issuer === 'Rafidain Bank / Qi Card');
    expect(qiRules.length).toBeGreaterThan(0);
    const fees = estimateFees(
      qiRules,
      {
        issuer: 'Rafidain Bank / Qi Card',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'ANY',
        onDate: '2026-09-02',
      },
      iqd(1_000_000),
    );
    expect(fees.total.known).toBe(false);
    if (fees.total.known) throw new Error('unreachable');
    expect(fees.total.missing.join(' ')).toMatch(/Confirm/);
  });

  it('a card with no tariff rules at all yields unknown, not free', () => {
    const fees = estimateFees(
      [],
      { issuer: 'Some Bank', transactionType: 'ATM_WITHDRAWAL', region: 'ANY', onDate: '2026-09-02' },
      iqd(1_000_000),
    );
    expect(fees.total.known).toBe(false);
    if (fees.total.known) throw new Error('unreachable');
    expect(fees.total.reason).toMatch(/No tariff rule on file/);
  });

  it('does not interpolate a missing fee from another card', () => {
    // NEO 964's ATM fee must not leak onto a Qi card.
    const fees = estimateFees(
      SEED_FEE_RULES,
      {
        issuer: 'Rafidain Bank / Qi Card',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'CEMEA',
        onDate: '2026-09-02',
      },
      iqd(1_000_000),
    );
    const ids = fees.components.map((c) => c.rule.id);
    expect(ids.every((id) => id.startsWith('seed_qi'))).toBe(true);
  });

  it('propagates unknown through combination', () => {
    const a = known(1, 'USER_ENTRY', 'OBSERVED', 'a');
    const b = unknown<number>('missing b', ['b']);
    const c = combine2(a, b, (x, y) => x + y, 'sum');
    expect(c.known).toBe(false);
  });

  it('has no function that turns unknown into a number', () => {
    const u = unknown<number>('nope', ['thing']);
    expect(() => expectKnown(u, 'test')).toThrow(/not determinable/);
  });

  it('will not derive cash-on-hand when spending is not tracked', () => {
    const pos = walletPosition('PERSONAL', []);
    const e = expectedCashOnHand(pos, false);
    expect(e.known).toBe(false);
  });

  it('refuses a reference IQD cost when no reference rate is on file', () => {
    const usdCard = card({ nativeCurrency: 'USD' });
    const c = computeWithdrawal(
      withdrawal({
        card: usdCard,
        posted: { debit: { minor: 27000n, currency: 'USD' }, postedAt: '2026-09-04T00:00:00Z' },
      }),
    );
    expect(c.referenceIqdCost.known).toBe(false);
    if (c.referenceIqdCost.known) throw new Error('unreachable');
    expect(c.referenceIqdCost.reason).toMatch(/No reference rate on file/);
  });
});
