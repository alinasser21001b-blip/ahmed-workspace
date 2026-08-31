import { add, isNegative, type Money, subtract, sum, zero } from './money.ts';
import { type Evidenced, known, unknown } from './evidence.ts';
import type { Ownership } from './states.ts';

/**
 * Physical SAR in the traveller's hands, kept strictly separate by ownership.
 *
 * The accounting principle this file encodes: a company ATM withdrawal is a
 * *transfer*, not an expense. The company card asset falls and company cash
 * rises by the same amount. Nothing here produces an expense — only an actual
 * cash expense does that.
 */
export type CashMovementKind = 'ATM_WITHDRAWAL' | 'EXPENSE' | 'ADJUSTMENT' | 'TRANSFER';

export interface CashMovement {
  readonly id: string;
  readonly ownership: Ownership;
  readonly direction: 'IN' | 'OUT';
  readonly amount: Money;
  readonly kind: CashMovementKind;
  readonly withdrawalId?: string | null;
  readonly expenseId?: string | null;
  readonly occurredAt: string;
  readonly notes?: string | null;
}

export class OwnershipLeakError extends Error {
  constructor(movementOwnership: Ownership, sourceOwnership: Ownership) {
    super(
      `Refusing to move ${sourceOwnership} money into the ${movementOwnership} wallet. ` +
        'Personal and company cash are never commingled.',
    );
    this.name = 'OwnershipLeakError';
  }
}

/**
 * Build the cash movement for a successful withdrawal.
 *
 * Returns null when no cash was dispensed — a failed ATM must never increase a
 * cash treasury, however the account was debited.
 */
export function movementForWithdrawal(args: {
  readonly withdrawalId: string;
  readonly cardOwnership: Ownership;
  readonly dispensedSar: Money;
  readonly occurredAt: string;
}): CashMovement | null {
  if (args.dispensedSar.currency !== 'SAR') {
    throw new TypeError(`Cash treasury holds SAR only; received ${args.dispensedSar.currency}`);
  }
  if (isNegative(args.dispensedSar)) {
    throw new RangeError('Cash dispensed cannot be negative.');
  }
  if (args.dispensedSar.minor === 0n) return null;

  return {
    id: `cm_${args.withdrawalId}`,
    ownership: args.cardOwnership,
    direction: 'IN',
    amount: args.dispensedSar,
    kind: 'ATM_WITHDRAWAL',
    withdrawalId: args.withdrawalId,
    occurredAt: args.occurredAt,
    notes: 'Cash withdrawn — a transfer from card balance to physical cash, not an expense.',
  };
}

export function assertOwnershipMatch(movement: CashMovement, sourceOwnership: Ownership): void {
  if (movement.ownership !== sourceOwnership) {
    throw new OwnershipLeakError(movement.ownership, sourceOwnership);
  }
}

export interface WalletPosition {
  readonly ownership: Ownership;
  readonly received: Money;
  readonly spent: Money;
  readonly adjustments: Money;
  readonly expectedOnHand: Money;
  readonly movementCount: number;
}

export function walletPosition(
  ownership: Ownership,
  movements: readonly CashMovement[],
): WalletPosition {
  const mine = movements.filter((m) => m.ownership === ownership);
  for (const m of mine) {
    if (m.amount.currency !== 'SAR') {
      throw new TypeError(`Cash wallet holds SAR only; found ${m.amount.currency}`);
    }
  }
  const received = sum(
    mine.filter((m) => m.direction === 'IN' && m.kind !== 'ADJUSTMENT').map((m) => m.amount),
    'SAR',
  );
  const spent = sum(
    mine.filter((m) => m.direction === 'OUT' && m.kind !== 'ADJUSTMENT').map((m) => m.amount),
    'SAR',
  );
  const adjIn = sum(
    mine.filter((m) => m.direction === 'IN' && m.kind === 'ADJUSTMENT').map((m) => m.amount),
    'SAR',
  );
  const adjOut = sum(
    mine.filter((m) => m.direction === 'OUT' && m.kind === 'ADJUSTMENT').map((m) => m.amount),
    'SAR',
  );
  const adjustments = subtract(adjIn, adjOut);
  const expectedOnHand = add(subtract(received, spent), adjustments);
  return { ownership, received, spent, adjustments, expectedOnHand, movementCount: mine.length };
}

export interface TreasurySummary {
  readonly personal: WalletPosition;
  readonly company: WalletPosition;
  readonly totalReceived: Money;
  readonly totalExpectedOnHand: Money;
}

export function treasurySummary(movements: readonly CashMovement[]): TreasurySummary {
  const personal = walletPosition('PERSONAL', movements);
  const company = walletPosition('COMPANY', movements);
  return {
    personal,
    company,
    totalReceived: add(personal.received, company.received),
    totalExpectedOnHand: add(personal.expectedOnHand, company.expectedOnHand),
  };
}

/**
 * Expected cash on hand, expressed as evidence rather than a bare number: it is
 * only trustworthy if every cash outflow has actually been recorded, which is
 * optional in this product.
 */
export function expectedCashOnHand(
  position: WalletPosition,
  expenseTrackingEnabled: boolean,
): Evidenced<Money> {
  if (!expenseTrackingEnabled) {
    return unknown(
      'Cash spending is not being recorded, so the cash still in hand cannot be derived.',
      ['Cash expense entries, or a counted cash adjustment'],
    );
  }
  return known(
    position.expectedOnHand,
    'DERIVED_CALCULATION',
    'OBSERVED',
    'Cash received from ATMs, minus recorded cash spending, plus recorded adjustments.',
  );
}

export function emptyWallet(ownership: Ownership): WalletPosition {
  return {
    ownership,
    received: zero('SAR'),
    spent: zero('SAR'),
    adjustments: zero('SAR'),
    expectedOnHand: zero('SAR'),
    movementCount: 0,
  };
}
