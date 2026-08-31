import { add, isNegative, subtract, sum, zero } from "./money.js";
import { known, unknown } from "./evidence.js";
export class OwnershipLeakError extends Error {
    constructor(movementOwnership, sourceOwnership) {
        super(`Refusing to move ${sourceOwnership} money into the ${movementOwnership} wallet. ` +
            'Personal and company cash are never commingled.');
        this.name = 'OwnershipLeakError';
    }
}
/**
 * Build the cash movement for a successful withdrawal.
 *
 * Returns null when no cash was dispensed — a failed ATM must never increase a
 * cash treasury, however the account was debited.
 */
export function movementForWithdrawal(args) {
    if (args.dispensedSar.currency !== 'SAR') {
        throw new TypeError(`Cash treasury holds SAR only; received ${args.dispensedSar.currency}`);
    }
    if (isNegative(args.dispensedSar)) {
        throw new RangeError('Cash dispensed cannot be negative.');
    }
    if (args.dispensedSar.minor === 0n)
        return null;
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
export function assertOwnershipMatch(movement, sourceOwnership) {
    if (movement.ownership !== sourceOwnership) {
        throw new OwnershipLeakError(movement.ownership, sourceOwnership);
    }
}
export function walletPosition(ownership, movements) {
    const mine = movements.filter((m) => m.ownership === ownership);
    for (const m of mine) {
        if (m.amount.currency !== 'SAR') {
            throw new TypeError(`Cash wallet holds SAR only; found ${m.amount.currency}`);
        }
    }
    const received = sum(mine.filter((m) => m.direction === 'IN' && m.kind !== 'ADJUSTMENT').map((m) => m.amount), 'SAR');
    const spent = sum(mine.filter((m) => m.direction === 'OUT' && m.kind !== 'ADJUSTMENT').map((m) => m.amount), 'SAR');
    const adjIn = sum(mine.filter((m) => m.direction === 'IN' && m.kind === 'ADJUSTMENT').map((m) => m.amount), 'SAR');
    const adjOut = sum(mine.filter((m) => m.direction === 'OUT' && m.kind === 'ADJUSTMENT').map((m) => m.amount), 'SAR');
    const adjustments = subtract(adjIn, adjOut);
    const expectedOnHand = add(subtract(received, spent), adjustments);
    return { ownership, received, spent, adjustments, expectedOnHand, movementCount: mine.length };
}
export function treasurySummary(movements) {
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
export function expectedCashOnHand(position, expenseTrackingEnabled) {
    if (!expenseTrackingEnabled) {
        return unknown('Cash spending is not being recorded, so the cash still in hand cannot be derived.', ['Cash expense entries, or a counted cash adjustment']);
    }
    return known(position.expectedOnHand, 'DERIVED_CALCULATION', 'OBSERVED', 'Cash received from ATMs, minus recorded cash spending, plus recorded adjustments.');
}
export function emptyWallet(ownership) {
    return {
        ownership,
        received: zero('SAR'),
        spent: zero('SAR'),
        adjustments: zero('SAR'),
        expectedOnHand: zero('SAR'),
        movementCount: 0,
    };
}
