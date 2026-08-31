import { abs, add, compare, isZero, type Money, subtract, sum, zero } from './money.ts';
import { type Evidenced, known, unknown } from './evidence.ts';
import type { DiscrepancyCause, WithdrawalState } from './states.ts';
import type { BalanceObservation, CardRef, WithdrawalComputation, WithdrawalInput } from './withdrawal.ts';

export interface PotentialCause {
  readonly cause: DiscrepancyCause;
  readonly rationale: string;
  /** Ranking hint only. Never used to auto-classify. */
  readonly likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ReconciliationResult {
  /** What our system says the after-balance should have been. */
  readonly expectedAfterBalance: Evidenced<Money>;
  readonly observedAfterBalance: Evidenced<Money>;
  /** observed - expected. Positive means the card holds more than we predicted. */
  readonly difference: Evidenced<Money>;
  readonly isReconciled: boolean;
  readonly potentialCauses: readonly PotentialCause[];
  readonly suggestedState: WithdrawalState;
  readonly explanation: string;
}

/**
 * Reconcile one withdrawal.
 *
 * The engine proposes; it never disposes. A non-zero difference produces a
 * ranked list of *candidate* explanations and stops there — classification is a
 * human act, because picking the wrong cause silently is exactly how a real
 * discrepancy gets buried.
 */
export function reconcileWithdrawal(
  input: WithdrawalInput,
  computation: WithdrawalComputation,
): ReconciliationResult {
  const { card } = input;
  const causes: PotentialCause[] = [];

  const before = input.before;
  const after = input.after;

  if (!before || !after) {
    return {
      expectedAfterBalance: unknown('Reconciliation needs both a before and an after balance.', [
        before ? null : 'Before balance',
        after ? null : 'After balance',
      ].filter((x): x is string => x !== null)),
      observedAfterBalance: after
        ? known(after.amount, 'BANK_APP', 'OBSERVED', `Observed ${after.balanceType} balance.`)
        : unknown('No after balance recorded.', ['After balance']),
      difference: unknown('Cannot reconcile without both balances.', ['Before balance', 'After balance']),
      isReconciled: false,
      potentialCauses: [],
      suggestedState: input.state,
      explanation: 'Not enough evidence to reconcile this withdrawal yet.',
    };
  }

  const cost = computation.nativeAllInCost;
  if (!cost.known) {
    return {
      expectedAfterBalance: unknown('The all-in cost is unknown, so no expected balance can be formed.', cost.missing),
      observedAfterBalance: known(after.amount, 'BANK_APP', 'OBSERVED', `Observed ${after.balanceType} balance.`),
      difference: unknown('Cannot reconcile until the cost of the withdrawal is determinable.', cost.missing),
      isReconciled: false,
      potentialCauses: [],
      suggestedState: input.state,
      explanation: 'Cannot determine a verified expected balance yet.',
    };
  }

  const expected = subtract(before.amount, cost.value);
  const expectedAfterBalance = known(
    expected,
    'DERIVED_CALCULATION',
    cost.confidence,
    `Before balance minus the ${computation.costBasis.toLowerCase()} all-in cost.`,
  );
  const observedAfterBalance = known(
    after.amount,
    'BANK_APP',
    'OBSERVED',
    `Observed ${after.balanceType} balance from ${after.source}.`,
  );
  const difference = subtract(after.amount, expected);
  const differenceEv = known(
    difference,
    'DERIVED_CALCULATION',
    cost.confidence,
    'Confirmed balance minus expected balance.',
  );

  const reconciled = isZero(difference);

  if (!reconciled) {
    const cardHoldsMore = difference.minor > 0n;

    if (computation.costBasis !== 'POSTED') {
      causes.push({
        cause: 'PENDING_HOLD',
        rationale:
          'The cost used is not the final posted figure. An authorisation hold commonly differs from the amount that eventually settles.',
        likelihood: 'HIGH',
      });
    }
    if (after.balanceType === 'AVAILABLE') {
      causes.push({
        cause: 'DELAYED_BALANCE_REFRESH',
        rationale:
          'The after balance is an AVAILABLE reading, which the bank may not have refreshed to its final value.',
        likelihood: 'HIGH',
      });
    }
    if (!cardHoldsMore) {
      causes.push({
        cause: 'SEPARATE_ISSUER_FEE',
        rationale:
          'The card lost more than expected, which is the signature of an issuer fee posted separately from the withdrawal.',
        likelihood: 'HIGH',
      });
      if (input.atmSurcharge) {
        causes.push({
          cause: 'ATM_SURCHARGE',
          rationale:
            'An ATM operator surcharge was recorded and may have been charged in addition to the withdrawal.',
          likelihood: 'MEDIUM',
        });
      }
      if (input.dcc.selection === 'BILLING_CURRENCY') {
        causes.push({
          cause: 'DCC',
          rationale:
            'Dynamic Currency Conversion was accepted, so the ATM operator set the rate and the cost may exceed the expectation.',
          likelihood: 'MEDIUM',
        });
      }
    } else {
      causes.push({
        cause: 'REVERSAL',
        rationale:
          'The card holds more than expected, which is consistent with a debit having been reversed or a hold released.',
        likelihood: 'MEDIUM',
      });
    }
    causes.push({
      cause: 'OTHER_TRANSACTION',
      rationale:
        'Another transaction may have occurred on this card between the two balance readings.',
      likelihood: 'MEDIUM',
    });
    causes.push({
      cause: 'ENTRY_ERROR',
      rationale: 'One of the recorded figures may have been mistyped.',
      likelihood: 'LOW',
    });
  }

  let suggestedState: WithdrawalState;
  if (reconciled) {
    suggestedState = computation.costBasis === 'POSTED' ? 'RECONCILED' : 'PARTIALLY_RECONCILED';
  } else {
    suggestedState = 'DISCREPANCY';
  }
  if (input.state === 'FAILED_ATM' || input.state === 'DISPUTED' || input.state === 'REVERSED') {
    suggestedState = input.state;
  }

  const explanation = reconciled
    ? computation.costBasis === 'POSTED'
      ? 'The confirmed bank balance matches the expected balance using the final posted cost.'
      : 'Balances agree, but the cost is not yet the final posted figure, so this is only partially reconciled.'
    : `Unexplained difference of ${abs(difference).minor.toString()} minor units in ${card.nativeCurrency}. ` +
      'This must be classified by a person; it is not resolved automatically.';

  return {
    expectedAfterBalance,
    observedAfterBalance,
    difference: differenceEv,
    isReconciled: reconciled && computation.costBasis === 'POSTED',
    potentialCauses: causes,
    suggestedState,
    explanation,
  };
}

/**
 * Card-level reconciliation: what our ledger says versus what the bank says.
 * The difference is surfaced, never hidden and never absorbed into a total.
 */
export interface CardLedgerInput {
  readonly card: CardRef;
  readonly openingAvailable: Money;
  readonly fundingCredits: readonly Money[];
  /** All-in costs of withdrawals that are known; unknown ones are counted separately. */
  readonly knownCosts: readonly Money[];
  readonly withdrawalsWithUnknownCost: number;
  readonly lastConfirmed?: BalanceObservation | null;
}

export interface CardLedgerResult {
  readonly expectedLedgerBalance: Evidenced<Money>;
  readonly lastConfirmedBankBalance: Evidenced<Money>;
  readonly reconciliationDifference: Evidenced<Money>;
  readonly hasUnexplainedDifference: boolean;
  readonly note: string;
}

export function computeCardLedger(input: CardLedgerInput): CardLedgerResult {
  const cur = input.card.nativeCurrency;
  const credits = sum(input.fundingCredits, cur);
  const costs = sum(input.knownCosts, cur);
  const expectedValue = subtract(add(input.openingAvailable, credits), costs);

  const expectedLedgerBalance: Evidenced<Money> =
    input.withdrawalsWithUnknownCost > 0
      ? unknown(
          `${input.withdrawalsWithUnknownCost} withdrawal(s) on this card have no determinable cost yet, ` +
            'so an expected balance would be wrong by an unknown amount.',
          ['Settlement details for the withdrawals still awaiting a posted amount'],
        )
      : known(
          expectedValue,
          'DERIVED_CALCULATION',
          'OBSERVED',
          'Opening balance plus recorded funding, minus the all-in cost of every recorded withdrawal.',
        );

  const lastConfirmedBankBalance: Evidenced<Money> = input.lastConfirmed
    ? known(
        input.lastConfirmed.amount,
        input.lastConfirmed.source === 'STATEMENT' ? 'BANK_STATEMENT' : 'BANK_APP',
        'OBSERVED',
        `Last confirmed ${input.lastConfirmed.balanceType} balance from ${input.lastConfirmed.source} at ${input.lastConfirmed.capturedAt}.`,
      )
    : unknown('No bank balance has been confirmed for this card yet.', [
        'A balance reading from the banking app or a statement',
      ]);

  let reconciliationDifference: Evidenced<Money>;
  if (expectedLedgerBalance.known && lastConfirmedBankBalance.known) {
    reconciliationDifference = known(
      subtract(lastConfirmedBankBalance.value, expectedLedgerBalance.value),
      'DERIVED_CALCULATION',
      'OBSERVED',
      'Confirmed bank balance minus expected ledger balance.',
    );
  } else {
    reconciliationDifference = unknown(
      'A reconciliation difference needs both an expected ledger balance and a confirmed bank balance.',
      [
        ...(expectedLedgerBalance.known ? [] : expectedLedgerBalance.missing),
        ...(lastConfirmedBankBalance.known ? [] : lastConfirmedBankBalance.missing),
      ],
    );
  }

  const hasUnexplainedDifference =
    reconciliationDifference.known && !isZero(reconciliationDifference.value);

  return {
    expectedLedgerBalance,
    lastConfirmedBankBalance,
    reconciliationDifference,
    hasUnexplainedDifference,
    note: hasUnexplainedDifference
      ? 'The bank and this ledger disagree. The difference is shown rather than absorbed.'
      : reconciliationDifference.known
        ? 'The bank balance agrees with this ledger.'
        : 'Not enough evidence to compare the bank balance with this ledger.',
  };
}

export function zeroFor(card: CardRef): Money {
  return zero(card.nativeCurrency);
}

