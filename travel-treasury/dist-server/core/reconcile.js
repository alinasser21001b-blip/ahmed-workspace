import { abs, add, isZero, subtract, sum, zero } from "./money.js";
import { EV, MSG, known, unknown } from "./evidence.js";
/**
 * Reconcile one withdrawal.
 *
 * The engine proposes; it never disposes. A non-zero difference produces a
 * ranked list of *candidate* explanations and stops there — classification is a
 * human act, because picking the wrong cause silently is exactly how a real
 * discrepancy gets buried.
 */
export function reconcileWithdrawal(input, computation) {
    const { card } = input;
    const causes = [];
    const before = input.before;
    const after = input.after;
    if (!before || !after) {
        return {
            expectedAfterBalance: unknown('Reconciliation needs both a before and an after balance.', [before ? null : EV.BEFORE_BALANCE, after ? null : EV.AFTER_BALANCE].filter((x) => x !== null), MSG.RECON_NEEDS_BALANCES),
            observedAfterBalance: after
                ? known(after.amount, 'BANK_APP', 'OBSERVED', `Observed ${after.balanceType} balance.`, MSG.OBSERVED_BALANCE)
                : unknown('No after balance recorded.', [EV.AFTER_BALANCE], MSG.RECON_NEEDS_BALANCES),
            difference: unknown('Cannot reconcile without both balances.', [EV.BEFORE_BALANCE, EV.AFTER_BALANCE], MSG.RECON_NEEDS_BALANCES),
            isReconciled: false,
            potentialCauses: [],
            suggestedState: input.state,
            explanation: 'Not enough evidence to reconcile this withdrawal yet.',
            explanationCode: MSG.E_NOT_ENOUGH_TO_RECONCILE,
        };
    }
    const cost = computation.nativeAllInCost;
    if (!cost.known) {
        return {
            expectedAfterBalance: unknown('The all-in cost is unknown, so no expected balance can be formed.', cost.missing, MSG.RECON_NEEDS_COST),
            observedAfterBalance: known(after.amount, 'BANK_APP', 'OBSERVED', `Observed ${after.balanceType} balance.`, MSG.OBSERVED_BALANCE),
            difference: unknown('Cannot reconcile until the cost of the withdrawal is determinable.', cost.missing, MSG.RECON_NEEDS_COST),
            isReconciled: false,
            potentialCauses: [],
            suggestedState: input.state,
            explanation: 'Cannot determine a verified expected balance yet.',
            explanationCode: MSG.E_CANNOT_EXPECT_BALANCE,
        };
    }
    const expected = subtract(before.amount, cost.value);
    const expectedAfterBalance = known(expected, 'DERIVED_CALCULATION', cost.confidence, `Before balance minus the ${computation.costBasis.toLowerCase()} all-in cost.`, MSG.EXPECTED_FROM_COST);
    const observedAfterBalance = known(after.amount, 'BANK_APP', 'OBSERVED', `Observed ${after.balanceType} balance from ${after.source}.`, MSG.OBSERVED_BALANCE);
    const difference = subtract(after.amount, expected);
    const differenceEv = known(difference, 'DERIVED_CALCULATION', cost.confidence, 'Confirmed balance minus expected balance.', MSG.DIFFERENCE_CONFIRMED_MINUS_EXPECTED);
    const reconciled = isZero(difference);
    if (!reconciled) {
        const cardHoldsMore = difference.minor > 0n;
        if (computation.costBasis !== 'POSTED') {
            causes.push({
                cause: 'PENDING_HOLD',
                rationale: 'The cost used is not the final posted figure. An authorisation hold commonly differs from the amount that eventually settles.',
                likelihood: 'HIGH',
            });
        }
        if (after.balanceType === 'AVAILABLE') {
            causes.push({
                cause: 'DELAYED_BALANCE_REFRESH',
                rationale: 'The after balance is an AVAILABLE reading, which the bank may not have refreshed to its final value.',
                likelihood: 'HIGH',
            });
        }
        if (!cardHoldsMore) {
            causes.push({
                cause: 'SEPARATE_ISSUER_FEE',
                rationale: 'The card lost more than expected, which is the signature of an issuer fee posted separately from the withdrawal.',
                likelihood: 'HIGH',
            });
            if (input.atmSurcharge) {
                causes.push({
                    cause: 'ATM_SURCHARGE',
                    rationale: 'An ATM operator surcharge was recorded and may have been charged in addition to the withdrawal.',
                    likelihood: 'MEDIUM',
                });
            }
            if (input.dcc.selection === 'BILLING_CURRENCY') {
                causes.push({
                    cause: 'DCC',
                    rationale: 'Dynamic Currency Conversion was accepted, so the ATM operator set the rate and the cost may exceed the expectation.',
                    likelihood: 'MEDIUM',
                });
            }
        }
        else {
            causes.push({
                cause: 'REVERSAL',
                rationale: 'The card holds more than expected, which is consistent with a debit having been reversed or a hold released.',
                likelihood: 'MEDIUM',
            });
        }
        causes.push({
            cause: 'OTHER_TRANSACTION',
            rationale: 'Another transaction may have occurred on this card between the two balance readings.',
            likelihood: 'MEDIUM',
        });
        causes.push({
            cause: 'ENTRY_ERROR',
            rationale: 'One of the recorded figures may have been mistyped.',
            likelihood: 'LOW',
        });
    }
    let suggestedState;
    if (reconciled) {
        suggestedState = computation.costBasis === 'POSTED' ? 'RECONCILED' : 'PARTIALLY_RECONCILED';
    }
    else {
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
    const explanationCode = reconciled
        ? computation.costBasis === 'POSTED'
            ? MSG.E_RECONCILED_POSTED
            : MSG.E_RECONCILED_NOT_POSTED
        : MSG.E_DIFFERENCE_NEEDS_PERSON;
    return {
        expectedAfterBalance,
        observedAfterBalance,
        difference: differenceEv,
        isReconciled: reconciled && computation.costBasis === 'POSTED',
        potentialCauses: causes,
        suggestedState,
        explanation,
        explanationCode,
    };
}
export function computeCardLedger(input) {
    const cur = input.card.nativeCurrency;
    const credits = sum(input.fundingCredits, cur);
    const costs = sum(input.knownCosts, cur);
    const expectedValue = subtract(add(input.openingAvailable, credits), costs);
    const expectedLedgerBalance = input.withdrawalsWithUnknownCost > 0
        ? unknown(`${input.withdrawalsWithUnknownCost} withdrawal(s) on this card have no determinable cost yet, ` +
            'so an expected balance would be wrong by an unknown amount.', [EV.SETTLEMENT_DETAILS], MSG.LEDGER_HAS_UNKNOWN_COSTS)
        : known(expectedValue, 'DERIVED_CALCULATION', 'OBSERVED', 'Opening balance plus recorded funding, minus the all-in cost of every recorded withdrawal.', MSG.LEDGER_FROM_OPENING);
    const lastConfirmedBankBalance = input.lastConfirmed
        ? known(input.lastConfirmed.amount, input.lastConfirmed.source === 'STATEMENT' ? 'BANK_STATEMENT' : 'BANK_APP', 'OBSERVED', `Last confirmed ${input.lastConfirmed.balanceType} balance from ${input.lastConfirmed.source} at ${input.lastConfirmed.capturedAt}.`, MSG.LAST_CONFIRMED)
        : unknown('No bank balance has been confirmed for this card yet.', [EV.BALANCE_READING], MSG.NO_CONFIRMED_BALANCE);
    let reconciliationDifference;
    if (expectedLedgerBalance.known && lastConfirmedBankBalance.known) {
        reconciliationDifference = known(subtract(lastConfirmedBankBalance.value, expectedLedgerBalance.value), 'DERIVED_CALCULATION', 'OBSERVED', 'Confirmed bank balance minus expected ledger balance.', MSG.DIFFERENCE_CONFIRMED_MINUS_EXPECTED);
    }
    else {
        reconciliationDifference = unknown('A reconciliation difference needs both an expected ledger balance and a confirmed bank balance.', [
            ...(expectedLedgerBalance.known ? [] : expectedLedgerBalance.missing),
            ...(lastConfirmedBankBalance.known ? [] : lastConfirmedBankBalance.missing),
        ], MSG.DIFF_NEEDS_BOTH);
    }
    const hasUnexplainedDifference = reconciliationDifference.known && !isZero(reconciliationDifference.value);
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
export function zeroFor(card) {
    return zero(card.nativeCurrency);
}
