export const WITHDRAWAL_STATES = [
    'DRAFT',
    'CAPTURED',
    'PENDING',
    'POSTED',
    'PARTIALLY_RECONCILED',
    'RECONCILED',
    'DISCREPANCY',
    'REVERSED',
    'DISPUTED',
    'FAILED_ATM',
    'PARTIAL_DISPENSE',
];
/**
 * Legal transitions. An illegal transition is rejected by the API rather than
 * quietly coerced, because a state machine that repairs itself hides the very
 * data-entry problem the traveller needs to see.
 */
const TRANSITIONS = {
    DRAFT: ['CAPTURED', 'FAILED_ATM', 'PARTIAL_DISPENSE', 'DRAFT'],
    CAPTURED: ['PENDING', 'POSTED', 'FAILED_ATM', 'PARTIAL_DISPENSE', 'DISCREPANCY', 'DISPUTED', 'CAPTURED'],
    PENDING: ['POSTED', 'REVERSED', 'DISCREPANCY', 'DISPUTED', 'FAILED_ATM', 'PENDING'],
    POSTED: ['PARTIALLY_RECONCILED', 'RECONCILED', 'DISCREPANCY', 'REVERSED', 'DISPUTED', 'POSTED'],
    PARTIALLY_RECONCILED: ['RECONCILED', 'DISCREPANCY', 'DISPUTED', 'REVERSED', 'PARTIALLY_RECONCILED'],
    RECONCILED: ['DISCREPANCY', 'REVERSED', 'DISPUTED'],
    DISCREPANCY: ['PARTIALLY_RECONCILED', 'RECONCILED', 'DISPUTED', 'REVERSED', 'POSTED', 'DISCREPANCY'],
    REVERSED: ['RECONCILED', 'DISPUTED', 'REVERSED'],
    DISPUTED: ['RECONCILED', 'REVERSED', 'DISCREPANCY', 'DISPUTED'],
    // A failed ATM still has money to chase: the debit may post, then reverse.
    FAILED_ATM: ['DISPUTED', 'PENDING', 'POSTED', 'REVERSED', 'RECONCILED', 'FAILED_ATM'],
    PARTIAL_DISPENSE: ['PENDING', 'POSTED', 'DISCREPANCY', 'DISPUTED', 'RECONCILED', 'PARTIAL_DISPENSE'],
};
export function canTransition(from, to) {
    return TRANSITIONS[from].includes(to);
}
export class IllegalTransitionError extends Error {
    constructor(from, to) {
        super(`Illegal withdrawal state transition: ${from} -> ${to}`);
        this.name = 'IllegalTransitionError';
    }
}
export function assertTransition(from, to) {
    if (!canTransition(from, to))
        throw new IllegalTransitionError(from, to);
}
/** States in which cash was actually received and the treasury should hold it. */
export function dispensedCash(state) {
    return state !== 'FAILED_ATM' && state !== 'DRAFT';
}
/** States whose pricing may be trusted for card recommendations. */
export function isSettledForRecommendation(state) {
    return state === 'RECONCILED';
}
