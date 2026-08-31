import { add, compare, isPositive, min as minMoney, type Money, subtract, zero } from './money.ts';
import { convert, invertRate, type Rate } from './rate.ts';
import { type Evidenced, known, unknown } from './evidence.ts';
import type { Ownership } from './states.ts';
import type { CardRef } from './withdrawal.ts';

/**
 * Everything the planner is allowed to know about a card. Each capacity is
 * optional, and a missing one is treated as "not established" rather than
 * "unlimited" — the difference matters when a bank refuses a withdrawal.
 */
export interface PlannerCard {
  readonly card: CardRef;
  /** Confirmed available balance in the card's own currency. */
  readonly availableNative?: Money | null;
  readonly dailyAtmLimit?: Money | null;
  readonly perTransactionLimit?: Money | null;
  /** Remaining regulatory monthly allowance abroad (research record CBI-04). */
  readonly regulatoryMonthlyRemaining?: Money | null;
  /** SAR already withdrawn on this card today. */
  readonly withdrawnTodaySar?: Money | null;
  /** Verified economic rate from reconciled withdrawals: SAR -> native. */
  readonly verifiedNativePerSar?: Rate | null;
  /** Fallback reference rate SAR -> native, clearly weaker. */
  readonly referenceNativePerSar?: Rate | null;
  /** Amount held in pending, not yet settled, in native currency. */
  readonly pendingNative?: Money | null;
}

export interface PlannerOptions {
  /** Saudi ATM per-transaction cap. Default from research record SA-03; UNVERIFIED. */
  readonly atmPerTransactionMaxSar?: Money;
  /** Restrict the plan to one ownership pool. */
  readonly ownership?: Ownership | 'ALL';
}

export type BindingConstraint =
  | 'AVAILABLE_BALANCE'
  | 'DAILY_LIMIT'
  | 'PER_TRANSACTION_LIMIT'
  | 'REGULATORY_MONTHLY_CAP'
  | 'ATM_MAX'
  | 'TARGET_MET';

export interface PlanAllocation {
  readonly card: CardRef;
  readonly sar: Money;
  readonly withdrawalCount: number;
  readonly perWithdrawalSar: Money;
  readonly estimatedCostNative: Evidenced<Money>;
  readonly rateBasis: 'VERIFIED' | 'REFERENCE' | 'NONE';
  readonly bindingConstraint: BindingConstraint;
  readonly notes: readonly string[];
}

export interface UnusableCard {
  readonly card: CardRef;
  readonly reason: string;
}

export interface WithdrawalPlan {
  readonly targetSar: Money;
  readonly allocations: readonly PlanAllocation[];
  readonly allocatedSar: Money;
  readonly shortfallSar: Money;
  readonly unusable: readonly UnusableCard[];
  readonly totalEstimatedCostIqd: Evidenced<Money>;
  readonly disclaimer: string;
  readonly overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

const DISCLAIMER =
  'This is a planning estimate. Final bank/ATM settlement may differ. ' +
  'هذه خطة تقديرية، وقد تختلف التسوية النهائية من البنك أو الصراف.';

function sarCapacityFromNative(amount: Money, sarToNative: Rate): Money {
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
export function planWithdrawals(
  targetSar: Money,
  cards: readonly PlannerCard[],
  opts: PlannerOptions = {},
): WithdrawalPlan {
  if (targetSar.currency !== 'SAR') {
    throw new TypeError(`Plan target must be SAR, received ${targetSar.currency}`);
  }
  const atmMax = opts.atmPerTransactionMaxSar ?? { minor: 500000n, currency: 'SAR' as const };
  const ownershipFilter = opts.ownership ?? 'ALL';

  const unusable: UnusableCard[] = [];
  type Candidate = {
    pc: PlannerCard;
    rate: Rate;
    rateBasis: 'VERIFIED' | 'REFERENCE';
    capacitySar: Money;
    binding: BindingConstraint;
    notes: string[];
  };
  const candidates: Candidate[] = [];

  for (const pc of cards) {
    const { card } = pc;
    if (ownershipFilter !== 'ALL' && card.ownership !== ownershipFilter) continue;

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
        reason:
          'It is not established whether this card works abroad. Confirm with the issuer before relying on it.',
      });
      continue;
    }

    const rate = pc.verifiedNativePerSar ?? pc.referenceNativePerSar ?? null;
    const rateBasis: 'VERIFIED' | 'REFERENCE' | null = pc.verifiedNativePerSar
      ? 'VERIFIED'
      : pc.referenceNativePerSar
        ? 'REFERENCE'
        : null;
    if (!rate || !rateBasis) {
      unusable.push({
        card,
        reason:
          'No verified or reference rate for this card, so how much SAR its balance yields cannot be estimated.',
      });
      continue;
    }
    if (rate.from !== 'SAR' || rate.to !== card.nativeCurrency) {
      throw new TypeError(
        `Planner rate for ${card.nickname} must be SAR -> ${card.nativeCurrency}, got ${rate.from} -> ${rate.to}`,
      );
    }

    const notes: string[] = [];
    let capacity: Money | null = null;
    let binding: BindingConstraint = 'AVAILABLE_BALANCE';

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
    } else {
      unusable.push({
        card,
        reason: 'No confirmed available balance, so no capacity can be planned against it.',
      });
      continue;
    }

    if (pc.dailyAtmLimit) {
      const limitSar =
        pc.dailyAtmLimit.currency === 'SAR'
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
    } else {
      notes.push('No daily limit is recorded for this card; capacity is not capped by one.');
    }

    if (pc.regulatoryMonthlyRemaining) {
      const regSar =
        pc.regulatoryMonthlyRemaining.currency === 'SAR'
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
    if (a.rateBasis !== b.rateBasis) return a.rateBasis === 'VERIFIED' ? -1 : 1;
    const l = a.rate.num * b.rate.den;
    const r = b.rate.num * a.rate.den;
    // Rates are SAR -> native in different currencies; only compare within the
    // same currency, otherwise keep the original order.
    if (a.pc.card.nativeCurrency !== b.pc.card.nativeCurrency) return 0;
    return l < r ? -1 : l > r ? 1 : 0;
  });

  const allocations: PlanAllocation[] = [];
  let remaining = targetSar;

  for (const c of candidates) {
    if (remaining.minor <= 0n) break;
    let take = minMoney(remaining, c.capacitySar);
    let binding = compare(c.capacitySar, remaining) < 0 ? c.binding : 'TARGET_MET';

    let perWithdrawal = atmMax;
    let perBinding: BindingConstraint = 'ATM_MAX';
    if (c.pc.perTransactionLimit) {
      const ptSar =
        c.pc.perTransactionLimit.currency === 'SAR'
          ? c.pc.perTransactionLimit
          : sarCapacityFromNative(c.pc.perTransactionLimit, c.rate);
      if (compare(ptSar, perWithdrawal) < 0) {
        perWithdrawal = ptSar;
        perBinding = 'PER_TRANSACTION_LIMIT';
      }
    }
    if (perWithdrawal.minor <= 0n) continue;

    // Whole number of trips to the machine.
    const count = Number((take.minor + perWithdrawal.minor - 1n) / perWithdrawal.minor);
    if (compare(take, perWithdrawal) > 0) {
      c.notes.push(
        `Requires ${count} separate withdrawals — the per-withdrawal cap here is the ${
          perBinding === 'ATM_MAX' ? 'Saudi ATM maximum' : "card's per-transaction limit"
        }.`,
      );
    }

    const cost: Evidenced<Money> = known(
      convert(take, c.rate),
      c.rateBasis === 'VERIFIED' ? 'DERIVED_CALCULATION' : 'REFERENCE_RATE',
      c.rateBasis === 'VERIFIED' ? 'POSTED' : 'ESTIMATED',
      c.rateBasis === 'VERIFIED'
        ? 'Estimated from this card’s own reconciled withdrawals.'
        : 'Estimated from a reference rate, not from this card’s settled history.',
    );

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
  let totalEstimatedCostIqd: Evidenced<Money>;
  const nonIqd = allocations.filter((a) => a.card.nativeCurrency !== 'IQD');
  if (allocations.length === 0) {
    totalEstimatedCostIqd = unknown('No allocations were possible.', ['A usable card with a rate']);
  } else if (nonIqd.length > 0) {
    totalEstimatedCostIqd = unknown(
      `${nonIqd.length} allocation(s) are on non-IQD cards; their dinar cost depends on how those funds were acquired.`,
      ['Funding records for the non-IQD cards in this plan'],
    );
  } else {
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
  const overallConfidence: WithdrawalPlan['overallConfidence'] =
    allocations.length === 0
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
