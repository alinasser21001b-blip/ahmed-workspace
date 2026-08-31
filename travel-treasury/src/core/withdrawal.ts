import type { CurrencyCode } from './currency.ts';
import {
  add,
  compare,
  equals,
  isZero,
  type Money,
  subtract,
  sum,
  zero,
} from './money.ts';
import { convert, effectiveRate, type Rate } from './rate.ts';
import {
  combine2,
  type Evidenced,
  known,
  type PricingConfidence,
  type Provenance,
  unknown,
  weakest,
} from './evidence.ts';
import type {
  BalanceSource,
  BalanceType,
  CardNetwork,
  CardType,
  DccOffered,
  DccSelection,
  InternationalStatus,
  Ownership,
  WithdrawalState,
} from './states.ts';

export interface CardRef {
  readonly id: string;
  readonly nickname: string;
  readonly issuer: string;
  readonly product: string;
  readonly network: CardNetwork;
  readonly cardType: CardType;
  readonly last4: string;
  readonly ownership: Ownership;
  readonly nativeCurrency: CurrencyCode;
  readonly internationalStatus: InternationalStatus;
}

export interface BalanceObservation {
  readonly amount: Money;
  readonly capturedAt: string;
  readonly source: BalanceSource;
  readonly balanceType: BalanceType;
}

export interface DccRecord {
  readonly offered: DccOffered;
  readonly selection?: DccSelection | null;
  readonly offeredRate?: Rate | null;
  readonly markupPercent?: string | null;
  readonly convertedAmount?: Money | null;
}

export interface PendingRecord {
  readonly debit: Money;
  readonly fee?: Money | null;
  readonly description?: string | null;
  readonly at: string;
}

export interface PostedRecord {
  readonly debit: Money;
  readonly bankFee?: Money | null;
  readonly internationalFee?: Money | null;
  readonly cashWithdrawalFee?: Money | null;
  readonly otherFee?: Money | null;
  readonly postedAt: string;
  readonly statementDescription?: string | null;
}

/**
 * Whether the ATM operator's surcharge is already inside the debit or arrives
 * as its own posting.
 *
 * This distinction is not pedantry. A Saudi ATM that adds SAR 21 to a SAR 1,000
 * withdrawal charges the card for SAR 1,021, so the surcharge is already inside
 * the native debit — adding it again to the all-in cost would overstate the
 * cost and understate the card. When it is genuinely unknown the engine adds
 * nothing and says so, rather than guessing in either direction.
 */
export type SurchargeHandling = 'INCLUDED_IN_DEBIT' | 'POSTED_SEPARATELY' | 'UNKNOWN';

export interface WithdrawalInput {
  readonly id: string;
  readonly card: CardRef;
  readonly state: WithdrawalState;
  readonly transactionAt: string;
  readonly postingDate?: string | null;
  readonly requestedSar?: Money | null;
  /** SAR actually dispensed. Never negative; zero for a failed ATM. */
  readonly dispensedSar: Money;
  readonly atmSurcharge?: Money | null;
  readonly surchargeHandling?: SurchargeHandling;
  readonly dcc: DccRecord;
  readonly before?: BalanceObservation | null;
  readonly after?: BalanceObservation | null;
  readonly pending?: PendingRecord | null;
  readonly posted?: PostedRecord | null;
}

/**
 * How the traveller's dinars were converted into this card's native units.
 * Without one of these, a USD card's real IQD cost is not knowable, and the
 * engine says so instead of reaching for a reference rate.
 */
export interface FundingBasis {
  /** IQD per 1 unit of the card's native currency, exact. */
  readonly iqdPerNativeUnit: Rate;
  readonly basis: string;
  readonly sampleCount: number;
}

export interface WithdrawalComputation {
  readonly observedBalanceDelta: Evidenced<Money>;
  readonly pendingDebitTotal: Evidenced<Money>;
  readonly postedDebitTotal: Evidenced<Money>;
  readonly issuerFees: Evidenced<Money>;
  readonly atmOperatorFee: Evidenced<Money>;
  readonly nativeAllInCost: Evidenced<Money>;
  readonly effectiveNativePerSar: Evidenced<Rate>;
  readonly referenceIqdCost: Evidenced<Money>;
  readonly economicIqdCost: Evidenced<Money>;
  readonly verifiedIqdPerSar: Evidenced<Rate>;
  readonly costBasis: 'POSTED' | 'OBSERVED' | 'PENDING' | 'NONE';
  readonly warnings: readonly string[];
}

function provenanceOfBalanceSource(s: BalanceSource): Provenance {
  switch (s) {
    case 'BANK_APP':
      return 'BANK_APP';
    case 'STATEMENT':
      return 'BANK_STATEMENT';
    case 'ATM_RECEIPT':
      return 'ATM_RECEIPT';
    case 'SMS':
      return 'BANK_APP';
    case 'MANUAL':
      return 'USER_ENTRY';
  }
}

function assertNative(m: Money, card: CardRef, what: string): void {
  if (m.currency !== card.nativeCurrency) {
    throw new TypeError(
      `${what} is ${m.currency} but card ${card.nickname} is denominated in ` +
        `${card.nativeCurrency}. A ${card.nativeCurrency} card must not be treated as ` +
        `a ${m.currency} card.`,
    );
  }
}

/**
 * The single canonical costing of a withdrawal. Everything that quotes a rate
 * or a cost anywhere in the product comes through here.
 */
export function computeWithdrawal(
  input: WithdrawalInput,
  opts: {
    readonly funding?: FundingBasis | null;
    /** Reference rate native -> IQD, for the clearly-labelled reference figure only. */
    readonly referenceRate?: Rate | null;
    readonly referenceRateLabel?: string;
  } = {},
): WithdrawalComputation {
  const { card, dispensedSar } = input;
  const native = card.nativeCurrency;
  const warnings: string[] = [];

  if (dispensedSar.currency !== 'SAR') {
    throw new TypeError(`dispensedSar must be SAR, received ${dispensedSar.currency}`);
  }
  if (dispensedSar.minor < 0n) {
    throw new RangeError('Cash dispensed cannot be negative.');
  }

  // ---- Observed balance delta -------------------------------------------
  let observedBalanceDelta: Evidenced<Money>;
  if (input.before && input.after) {
    assertNative(input.before.amount, card, 'Before balance');
    assertNative(input.after.amount, card, 'After balance');
    const delta = subtract(input.before.amount, input.after.amount);
    const provenance = provenanceOfBalanceSource(input.after.source);
    observedBalanceDelta = known(
      delta,
      provenance,
      'OBSERVED',
      `Before balance minus after balance (${input.before.source}/${input.before.balanceType} → ` +
        `${input.after.source}/${input.after.balanceType}). Observed, not necessarily final.`,
    );
    if (input.after.balanceType === 'AVAILABLE') {
      warnings.push(
        'After balance is an AVAILABLE reading: it may reflect an authorisation hold rather than the final posted amount.',
      );
    }
    if (delta.minor < 0n) {
      warnings.push('Balance increased across this withdrawal — check the readings or look for an unrelated credit.');
    }
  } else {
    observedBalanceDelta = unknown(
      'Both a before and an after balance are needed to observe the balance delta.',
      [
        input.before ? null : 'Before balance',
        input.after ? null : 'After balance',
      ].filter((x): x is string => x !== null),
    );
  }

  // ---- Pending ----------------------------------------------------------
  let pendingDebitTotal: Evidenced<Money>;
  if (input.pending) {
    assertNative(input.pending.debit, card, 'Pending debit');
    const total = input.pending.fee
      ? add(input.pending.debit, input.pending.fee)
      : input.pending.debit;
    pendingDebitTotal = known(
      total,
      'BANK_APP',
      'PENDING',
      `Pending debit${input.pending.fee ? ' plus pending fee' : ''} as shown by the banking app. Not final.`,
    );
  } else {
    pendingDebitTotal = unknown('No pending transaction has been recorded.', [
      'Pending debit from the banking app',
    ]);
  }

  // ---- Posted -----------------------------------------------------------
  let postedDebitTotal: Evidenced<Money>;
  let issuerFees: Evidenced<Money>;
  if (input.posted) {
    assertNative(input.posted.debit, card, 'Posted debit');
    postedDebitTotal = known(
      input.posted.debit,
      'BANK_STATEMENT',
      'POSTED',
      'Final posted debit from the bank.',
    );
    const feeParts = [
      input.posted.bankFee,
      input.posted.internationalFee,
      input.posted.cashWithdrawalFee,
      input.posted.otherFee,
    ].filter((f): f is Money => f != null);
    for (const f of feeParts) assertNative(f, card, 'Posted fee');
    issuerFees = known(
      sum(feeParts, native),
      'BANK_STATEMENT',
      'POSTED',
      feeParts.length === 0
        ? 'No separately posted issuer fee recorded; any fee may be embedded in the posted debit.'
        : `Sum of ${feeParts.length} separately posted issuer fee(s).`,
    );
  } else {
    postedDebitTotal = unknown('The final posted transaction has not been recorded yet.', [
      'Final posted debit from the bank statement',
    ]);
    issuerFees = unknown('Issuer fees are only known once the transaction has posted.', [
      'Posted fee lines from the bank statement',
    ]);
  }

  // ---- ATM operator surcharge ------------------------------------------
  const handling: SurchargeHandling = input.surchargeHandling ?? 'UNKNOWN';
  let atmOperatorFee: Evidenced<Money>;
  if (input.atmSurcharge) {
    atmOperatorFee = known(
      input.atmSurcharge,
      'ATM_RECEIPT',
      'OBSERVED',
      handling === 'INCLUDED_IN_DEBIT'
        ? 'ATM operator surcharge, already included in the card debit.'
        : handling === 'POSTED_SEPARATELY'
          ? 'ATM operator surcharge, posted separately from the withdrawal.'
          : 'ATM operator surcharge as displayed. Whether it is inside the debit or posted separately is not established.',
    );
    if (handling === 'UNKNOWN') {
      warnings.push(
        'ATM surcharge recorded, but it is not established whether it sits inside the card debit or posts separately. It has not been added to the all-in cost.',
      );
    }
  } else {
    atmOperatorFee = unknown('No ATM operator surcharge was recorded.', [
      'ATM surcharge shown on the machine or receipt',
    ]);
  }

  // ---- Native all-in cost ----------------------------------------------
  // Preference order: what the bank finally took > what we observed > what is
  // pending. Each is labelled, so the UI never implies a pending figure is final.
  let nativeAllInCost: Evidenced<Money>;
  let costBasis: WithdrawalComputation['costBasis'] = 'NONE';

  const separateSurcharge: Money | null =
    handling === 'POSTED_SEPARATELY' && input.atmSurcharge && input.atmSurcharge.currency === native
      ? input.atmSurcharge
      : null;
  if (handling === 'POSTED_SEPARATELY' && input.atmSurcharge && input.atmSurcharge.currency !== native) {
    warnings.push(
      `ATM surcharge is recorded in ${input.atmSurcharge.currency} but posts separately in ${native}; ` +
        'it has not been converted or added, because converting it would require an unverified rate.',
    );
  }

  if (postedDebitTotal.known && issuerFees.known) {
    let total = add(postedDebitTotal.value, issuerFees.value);
    if (separateSurcharge) total = add(total, separateSurcharge);
    nativeAllInCost = known(
      total,
      'BANK_STATEMENT',
      'POSTED',
      'Posted debit plus separately posted issuer fees' +
        (separateSurcharge ? ' plus separately posted ATM surcharge.' : '.'),
    );
    costBasis = 'POSTED';
  } else if (observedBalanceDelta.known) {
    nativeAllInCost = known(
      observedBalanceDelta.value,
      observedBalanceDelta.provenance,
      'OBSERVED',
      'Observed reduction in card balance. Not yet confirmed against a posted statement.',
    );
    costBasis = 'OBSERVED';
  } else if (pendingDebitTotal.known) {
    nativeAllInCost = known(
      pendingDebitTotal.value,
      'BANK_APP',
      'PENDING',
      'Pending amount only. The final posted amount frequently differs.',
    );
    costBasis = 'PENDING';
  } else {
    nativeAllInCost = unknown(
      'The cost of this withdrawal in the card currency is not yet determinable.',
      ['Before and after balances', 'or the pending debit', 'or the final posted debit'],
    );
  }

  // ---- Effective native rate -------------------------------------------
  let effectiveNativePerSar: Evidenced<Rate>;
  if (!nativeAllInCost.known) {
    effectiveNativePerSar = unknown(
      'Cannot determine verified effective rate yet: the cost in the card currency is unknown.',
      nativeAllInCost.missing,
    );
  } else if (isZero(dispensedSar)) {
    effectiveNativePerSar = unknown(
      'No cash was dispensed, so this withdrawal has no exchange rate. A cost divided by zero cash is not a rate.',
      ['Cash actually dispensed (currently 0 SAR)'],
    );
  } else {
    const r = effectiveRate(nativeAllInCost.value, dispensedSar);
    effectiveNativePerSar = r
      ? known(
          r,
          'DERIVED_CALCULATION',
          nativeAllInCost.confidence,
          `All-in cost in ${native} divided by SAR actually dispensed (${costBasis} basis).`,
        )
      : unknown('No cash dispensed.', ['Cash actually dispensed']);
  }

  // ---- Reference IQD cost (clearly labelled as reference) --------------
  let referenceIqdCost: Evidenced<Money>;
  if (!nativeAllInCost.known) {
    referenceIqdCost = unknown('The native cost is unknown, so no reference conversion is possible.', nativeAllInCost.missing);
  } else if (native === 'IQD') {
    referenceIqdCost = known(
      nativeAllInCost.value,
      nativeAllInCost.provenance,
      nativeAllInCost.confidence,
      'Card is denominated in IQD; the native cost is the IQD cost.',
    );
  } else if (opts.referenceRate) {
    if (opts.referenceRate.from !== native || opts.referenceRate.to !== 'IQD') {
      throw new TypeError(
        `Reference rate must convert ${native} -> IQD, received ${opts.referenceRate.from} -> ${opts.referenceRate.to}`,
      );
    }
    referenceIqdCost = known(
      convert(nativeAllInCost.value, opts.referenceRate),
      'REFERENCE_RATE',
      'ESTIMATED',
      `Reference conversion only, using ${opts.referenceRateLabel ?? 'a stored reference rate'}. ` +
        'This is NOT what these funds actually cost in dinars.',
    );
  } else {
    referenceIqdCost = unknown(
      `No reference rate on file for ${native} → IQD.`,
      [`A reference ${native}/IQD rate with a source and date`],
    );
  }

  // ---- Economic IQD cost (the real one) --------------------------------
  let economicIqdCost: Evidenced<Money>;
  if (!nativeAllInCost.known) {
    economicIqdCost = unknown('The native cost is unknown.', nativeAllInCost.missing);
  } else if (native === 'IQD') {
    economicIqdCost = known(
      nativeAllInCost.value,
      nativeAllInCost.provenance,
      nativeAllInCost.confidence,
      'Card is denominated in IQD; dinars leaving the card are real dinars.',
    );
  } else if (opts.funding) {
    const f = opts.funding;
    if (f.iqdPerNativeUnit.from !== native || f.iqdPerNativeUnit.to !== 'IQD') {
      throw new TypeError(
        `Funding basis must convert ${native} -> IQD, received ` +
          `${f.iqdPerNativeUnit.from} -> ${f.iqdPerNativeUnit.to}`,
      );
    }
    economicIqdCost = known(
      convert(nativeAllInCost.value, f.iqdPerNativeUnit),
      'DERIVED_CALCULATION',
      weakest(nativeAllInCost.confidence, 'POSTED'),
      `Native cost converted at the rate these ${native} funds were actually acquired at ` +
        `(${f.basis}, ${f.sampleCount} funding record(s)).`,
    );
  } else {
    economicIqdCost = unknown(
      `Not enough evidence: this is a ${native} card, and the real dinar cost depends on the rate ` +
        `at which those ${native} were funded.`,
      [`A funding/reload record for this card showing IQD actually paid for ${native} credited`],
    );
  }

  // ---- Verified economic IQD/SAR rate ----------------------------------
  let verifiedIqdPerSar: Evidenced<Rate>;
  if (!economicIqdCost.known) {
    verifiedIqdPerSar = unknown(
      'Cannot determine verified effective rate yet.',
      economicIqdCost.missing,
    );
  } else if (isZero(dispensedSar)) {
    verifiedIqdPerSar = unknown(
      'No cash was dispensed, so there is no IQD/SAR rate for this withdrawal.',
      ['Cash actually dispensed (currently 0 SAR)'],
    );
  } else {
    const r = effectiveRate(economicIqdCost.value, dispensedSar);
    verifiedIqdPerSar = r
      ? known(
          r,
          'DERIVED_CALCULATION',
          economicIqdCost.confidence,
          'Economic IQD cost divided by SAR actually dispensed.',
        )
      : unknown('No cash dispensed.', ['Cash actually dispensed']);
  }

  // ---- Warnings ---------------------------------------------------------
  if (input.dcc.offered === 'YES' && input.dcc.selection === 'BILLING_CURRENCY') {
    warnings.push(
      'Dynamic Currency Conversion was accepted: the ATM operator set the exchange rate, which is typically well above the network rate.',
    );
  }
  if (input.dcc.offered === 'UNKNOWN') {
    warnings.push('It is not recorded whether the ATM offered currency conversion (DCC).');
  }
  if (input.requestedSar && !equals(input.requestedSar, dispensedSar)) {
    warnings.push(
      `Requested and dispensed cash differ. All cost figures use the cash actually dispensed.`,
    );
  }
  if (isZero(dispensedSar)) {
    warnings.push('No cash was dispensed. This withdrawal must not credit any cash treasury.');
  }
  if (card.internationalStatus === 'RESTRICTED_BY_REGULATION') {
    warnings.push('This card is recorded as restricted for international use by regulation.');
  }
  if (postedDebitTotal.known && observedBalanceDelta.known) {
    const posted = nativeAllInCost.known && costBasis === 'POSTED' ? nativeAllInCost.value : null;
    if (posted && compare(posted, observedBalanceDelta.value) !== 0) {
      warnings.push(
        'The posted all-in cost differs from the observed balance change. Both are preserved; see reconciliation.',
      );
    }
  }

  return {
    observedBalanceDelta,
    pendingDebitTotal,
    postedDebitTotal,
    issuerFees,
    atmOperatorFee,
    nativeAllInCost,
    effectiveNativePerSar,
    referenceIqdCost,
    economicIqdCost,
    verifiedIqdPerSar,
    costBasis,
    warnings,
  };
}

/**
 * Funding basis derived from recorded reload events: total IQD actually paid
 * (including funding fees) per native unit credited. Exact rational, no float.
 */
export interface FundingEvent {
  readonly credited: Money;
  readonly iqdPaid?: Money | null;
  readonly fundingFee?: Money | null;
  readonly occurredAt: string;
}

export function fundingBasisFrom(
  events: readonly FundingEvent[],
  nativeCurrency: CurrencyCode,
): FundingBasis | null {
  if (nativeCurrency === 'IQD') return null;
  const usable = events.filter((e) => e.iqdPaid != null && e.credited.currency === nativeCurrency);
  if (usable.length === 0) return null;

  let totalIqdMinor = 0n;
  let totalCreditedMinor = 0n;
  for (const e of usable) {
    let paid = e.iqdPaid as Money;
    if (paid.currency !== 'IQD') continue;
    if (e.fundingFee) {
      if (e.fundingFee.currency !== 'IQD') continue;
      paid = add(paid, e.fundingFee);
    }
    totalIqdMinor += paid.minor;
    totalCreditedMinor += e.credited.minor;
  }
  if (totalCreditedMinor === 0n) return null;

  // IQD per 1 native major unit, exact:
  //   (iqdMinor / 10^iqdScale) / (nativeMinor / 10^nativeScale)
  const iqdCost: Money = { minor: totalIqdMinor, currency: 'IQD' };
  const credited: Money = { minor: totalCreditedMinor, currency: nativeCurrency };
  const r = effectiveRate(iqdCost, credited);
  if (!r) return null;
  return {
    iqdPerNativeUnit: r,
    basis: `weighted average of recorded fundings, fees included`,
    sampleCount: usable.length,
  };
}

/** Convenience for the zero-value case used widely in aggregation. */
export function zeroNative(card: CardRef): Money {
  return zero(card.nativeCurrency);
}
