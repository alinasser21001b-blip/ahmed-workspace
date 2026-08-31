/**
 * Withdrawal lifecycle.
 *
 * Nothing here collapses to "completed". Two orthogonal facts are being tracked
 * and both matter: what the machine physically did (FAILED_ATM,
 * PARTIAL_DISPENSE) and where the money currently is (PENDING, POSTED,
 * RECONCILED). A partial dispense still has to settle, which is why it is a
 * state that can move on rather than a terminus.
 */
export type WithdrawalState =
  | 'DRAFT'
  | 'CAPTURED'
  | 'PENDING'
  | 'POSTED'
  | 'PARTIALLY_RECONCILED'
  | 'RECONCILED'
  | 'DISCREPANCY'
  | 'REVERSED'
  | 'DISPUTED'
  | 'FAILED_ATM'
  | 'PARTIAL_DISPENSE';

export const WITHDRAWAL_STATES: readonly WithdrawalState[] = [
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
const TRANSITIONS: Record<WithdrawalState, readonly WithdrawalState[]> = {
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

export function canTransition(from: WithdrawalState, to: WithdrawalState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: WithdrawalState, to: WithdrawalState) {
    super(`Illegal withdrawal state transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: WithdrawalState, to: WithdrawalState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** States in which cash was actually received and the treasury should hold it. */
export function dispensedCash(state: WithdrawalState): boolean {
  return state !== 'FAILED_ATM' && state !== 'DRAFT';
}

/** States whose pricing may be trusted for card recommendations. */
export function isSettledForRecommendation(state: WithdrawalState): boolean {
  return state === 'RECONCILED';
}

export type Ownership = 'PERSONAL' | 'COMPANY';
export type CardNetwork = 'VISA' | 'MASTERCARD' | 'OTHER' | 'UNKNOWN';
export type CardType = 'DEBIT' | 'CREDIT' | 'PREPAID' | 'CORPORATE' | 'UNKNOWN';
export type BalanceSource = 'BANK_APP' | 'SMS' | 'ATM_RECEIPT' | 'STATEMENT' | 'MANUAL';
export type BalanceType = 'AVAILABLE' | 'LEDGER' | 'UNKNOWN';
export type DccOffered = 'YES' | 'NO' | 'UNKNOWN';
export type DccSelection = 'LOCAL_CURRENCY' | 'BILLING_CURRENCY' | 'UNKNOWN';

/**
 * Whether a card can be used abroad at all. A direct consequence of research
 * record CBI-06: a reported CBI directive may prevent Mastercard products
 * working internationally, so "does this card work in Saudi Arabia" is evidence
 * to be recorded, not an assumption to be made.
 */
export type InternationalStatus =
  | 'CONFIRMED_WORKING'
  | 'CLAIMED_BY_ISSUER'
  | 'RESTRICTED_BY_REGULATION'
  | 'UNKNOWN';

export type DiscrepancyCause =
  | 'PENDING_HOLD'
  | 'SEPARATE_ISSUER_FEE'
  | 'ATM_SURCHARGE'
  | 'OTHER_TRANSACTION'
  | 'DELAYED_BALANCE_REFRESH'
  | 'DCC'
  | 'REVERSAL'
  | 'ENTRY_ERROR'
  | 'UNKNOWN';
