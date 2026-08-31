import { format, toDecimalString, toWire, type Money, zero, add } from '../core/money.ts';
import { formatRate, invertRate, rateFromDecimal, rateToDecimalString, rateToWire, type Rate } from '../core/rate.ts';
import type { Evidenced } from '../core/evidence.ts';
import { computeCardLedger } from '../core/reconcile.ts';
import { treasurySummary, type CashMovement } from '../core/treasury.ts';
import { rankCards, buildComparison, type CardEvidence, type SettledObservation } from '../core/bestcard.ts';
import { planWithdrawals, type PlannerCard } from '../core/planner.ts';
import { effectiveRate } from '../core/rate.ts';
import { fundingBasisFrom } from '../core/withdrawal.ts';
import type { Db } from './db/db.ts';
import { evaluateWithdrawal } from './services.ts';
import {
  cardRefFrom, fundingEventsFor, latestReferenceRate, observationFrom,
  type CardRow, type SnapshotRow, type WithdrawalRow,
} from './repo.ts';
import { moneyFrom } from './repo.ts';
import { parseMinor, riyadhDate } from './util.ts';
import type { CurrencyCode } from '../core/currency.ts';

/**
 * Money always crosses the wire as a decimal string. Drivers hand BIGINT back
 * as a string, a number or a bigint depending on the column and the driver, and
 * a number reaching the client is both a precision hazard and — as this caught —
 * a crash. Everything monetary goes through here.
 */
function str(v: string | number | bigint | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : v.toString();
}

/** Wire form of an Evidenced value: bigint-free, ready for JSON. */
export function evidencedToWire(e: Evidenced<Money>): unknown {
  if (!e.known) return { known: false, reason: e.reason, missing: e.missing, code: e.code ?? null };
  return {
    known: true,
    money: toWire(e.value),
    display: toDecimalString(e.value),
    currency: e.value.currency,
    provenance: e.provenance,
    confidence: e.confidence,
    basis: e.basis,
    code: e.code ?? null,
  };
}

export function evidencedRateToWire(e: Evidenced<Rate>): unknown {
  if (!e.known) return { known: false, reason: e.reason, missing: e.missing, code: e.code ?? null };
  return {
    known: true,
    rate: rateToWire(e.value),
    display: rateToDecimalString(e.value, 4),
    label: formatRate(e.value, 4),
    provenance: e.provenance,
    confidence: e.confidence,
    basis: e.basis,
    code: e.code ?? null,
  };
}

async function movementsForTrip(db: Db, tripId: string): Promise<CashMovement[]> {
  const res = await db.query<{
    id: string; ownership: 'PERSONAL' | 'COMPANY'; direction: 'IN' | 'OUT'; amount_minor: string;
    kind: CashMovement['kind']; withdrawal_id: string | null; expense_id: string | null; occurred_at: string; notes: string | null;
  }>(
    `SELECT m.id, w.ownership, m.direction, m.amount_minor, m.kind, m.withdrawal_id, m.expense_id, m.occurred_at, m.notes
       FROM cash_movements m JOIN cash_wallets w ON w.id = m.wallet_id
      WHERE w.trip_id = $1 ORDER BY m.occurred_at`,
    [tripId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    ownership: r.ownership,
    direction: r.direction,
    amount: { minor: BigInt(r.amount_minor), currency: 'SAR' as const },
    kind: r.kind,
    withdrawalId: r.withdrawal_id,
    expenseId: r.expense_id,
    occurredAt: new Date(r.occurred_at).toISOString(),
    notes: r.notes,
  }));
}

/** Collect the per-card settled evidence used by ranking, comparison and planner. */
async function evidenceForCards(db: Db, tripId: string): Promise<{
  evidence: CardEvidence[];
  extras: Map<string, { totalFeesNative: Money; dccUsedCount: number; atmOperators: string[] }>;
  cards: CardRow[];
}> {
  const cardsRes = await db.query<CardRow>(`SELECT * FROM cards WHERE trip_id = $1 AND is_active ORDER BY created_at`, [tripId]);
  const evidence: CardEvidence[] = [];
  const extras = new Map<string, { totalFeesNative: Money; dccUsedCount: number; atmOperators: string[] }>();

  for (const cardRow of cardsRes.rows) {
    const card = cardRefFrom(cardRow);
    const wdRes = await db.query<WithdrawalRow>(
      `SELECT * FROM withdrawals WHERE card_id = $1 AND state NOT IN ('DRAFT') ORDER BY transaction_at`,
      [cardRow.id],
    );
    const funding = fundingBasisFrom(await fundingEventsFor(db, cardRow.id), card.nativeCurrency);
    const observations: SettledObservation[] = [];
    let fees = zero(card.nativeCurrency);
    let dccUsed = 0;
    const operators = new Set<string>();

    for (const row of wdRes.rows) {
      if (row.atm_operator) operators.add(row.atm_operator);
      if (row.dcc_selection === 'BILLING_CURRENCY') dccUsed += 1;
      for (const f of [row.posted_bank_fee_minor, row.posted_international_fee_minor, row.posted_cash_withdrawal_fee_minor, row.posted_other_fee_minor]) {
        if (f) fees = add(fees, { minor: BigInt(f), currency: card.nativeCurrency });
      }
      if (row.state !== 'RECONCILED') continue;
      if (!row.posted_debit_minor || BigInt(row.dispensed_sar_minor) === 0n) continue;
      let allIn = BigInt(row.posted_debit_minor);
      for (const f of [row.posted_bank_fee_minor, row.posted_international_fee_minor, row.posted_cash_withdrawal_fee_minor, row.posted_other_fee_minor]) {
        if (f) allIn += BigInt(f);
      }
      const dispensed: Money = { minor: BigInt(row.dispensed_sar_minor), currency: 'SAR' };
      const nativeCost: Money = { minor: allIn, currency: card.nativeCurrency };
      const nativePerSar = effectiveRate(nativeCost, dispensed);
      if (!nativePerSar) continue;
      let iqdPerSar: Rate | null = null;
      if (card.nativeCurrency === 'IQD') {
        iqdPerSar = nativePerSar;
      } else if (funding) {
        // Compose exactly: (native per SAR) x (IQD per native) = IQD per SAR.
        iqdPerSar = {
          num: nativePerSar.num * funding.iqdPerNativeUnit.num,
          den: nativePerSar.den * funding.iqdPerNativeUnit.den,
          from: 'SAR',
          to: 'IQD',
        };
      }
      observations.push({
        withdrawalId: row.id,
        transactionAt: new Date(row.transaction_at).toISOString(),
        nativePerSar,
        iqdPerSar,
        dispensedSar: dispensed,
        confidence: 'RECONCILED',
        isReconciled: true,
      });
    }
    evidence.push({ card, observations });
    extras.set(cardRow.id, { totalFeesNative: fees, dccUsedCount: dccUsed, atmOperators: [...operators] });
  }
  return { evidence, extras, cards: cardsRes.rows };
}

export async function dashboardView(db: Db, tripId: string, scope: 'ALL' | 'PERSONAL' | 'COMPANY') {
  const movements = await movementsForTrip(db, tripId);
  const treasury = treasurySummary(movements);

  const filter = scope === 'ALL' ? '' : `AND ownership = '${scope}'`;
  const counts = await db.query<{ state: string; n: number; sar: string }>(
    `SELECT state, count(*)::int AS n, coalesce(sum(dispensed_sar_minor),0)::text AS sar
       FROM withdrawals WHERE trip_id = $1 ${filter} GROUP BY state`,
    [tripId],
  );
  const byState: Record<string, { n: number; sarMinor: string }> = {};
  let totalSar = 0n;
  let count = 0;
  for (const r of counts.rows) {
    byState[r.state] = { n: r.n, sarMinor: r.sar };
    if (r.state !== 'DRAFT' && r.state !== 'FAILED_ATM' && r.state !== 'REVERSED') {
      totalSar += BigInt(r.sar);
      count += r.n;
    }
  }

  const feeRes = await db.query<{ cur: string; total: string }>(
    `SELECT posted_debit_currency AS cur,
            (coalesce(sum(posted_bank_fee_minor),0) + coalesce(sum(posted_international_fee_minor),0) +
             coalesce(sum(posted_cash_withdrawal_fee_minor),0) + coalesce(sum(posted_other_fee_minor),0))::text AS total
       FROM withdrawals WHERE trip_id = $1 ${filter} AND posted_debit_minor IS NOT NULL GROUP BY posted_debit_currency`,
    [tripId],
  );

  const openDisc = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM discrepancies d JOIN withdrawals w ON w.id = d.withdrawal_id
      WHERE w.trip_id = $1 ${filter.replace('ownership', 'w.ownership')} AND d.user_classification IS NULL`,
    [tripId],
  );

  const refs = await db.query<{ base_currency: string; quote_currency: string; rate: string; rate_type: string; effective_date: string }>(
    `SELECT DISTINCT ON (base_currency, quote_currency) base_currency, quote_currency, rate::text AS rate, rate_type, effective_date::text AS effective_date
       FROM reference_rates ORDER BY base_currency, quote_currency, effective_date DESC, fetched_at DESC`,
  );

  return {
    scope,
    treasury: {
      personal: {
        received: toWire(treasury.personal.received),
        spent: toWire(treasury.personal.spent),
        expectedOnHand: toWire(treasury.personal.expectedOnHand),
      },
      company: {
        received: toWire(treasury.company.received),
        spent: toWire(treasury.company.spent),
        expectedOnHand: toWire(treasury.company.expectedOnHand),
      },
      totalReceived: toWire(treasury.totalReceived),
    },
    withdrawals: {
      totalDispensedSarMinor: totalSar.toString(),
      count,
      byState,
      openDiscrepancies: openDisc.rows[0]?.n ?? 0,
    },
    verifiedFees: feeRes.rows.filter((r) => r.cur).map((r) => ({ currency: r.cur, totalMinor: r.total })),
    referenceRates: refs.rows.map((r) => ({
      pair: `${r.base_currency}/${r.quote_currency}`,
      rate: r.rate,
      rateType: r.rate_type,
      effectiveDate: String(r.effective_date).slice(0, 10),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function cardDashboard(db: Db, cardId: string) {
  const cardRes = await db.query<CardRow>(`SELECT * FROM cards WHERE id = $1`, [cardId]);
  const cardRow = cardRes.rows[0];
  if (!cardRow) return null;
  const card = cardRefFrom(cardRow);

  const wdRes = await db.query<WithdrawalRow>(
    `SELECT * FROM withdrawals WHERE card_id = $1 ORDER BY transaction_at DESC`,
    [cardId],
  );
  const snapRes = await db.query<SnapshotRow>(
    `SELECT * FROM balance_snapshots WHERE card_id = $1 ORDER BY captured_at DESC LIMIT 1`,
    [cardId],
  );
  const fundRes = await db.query<{ credited_minor: string }>(
    `SELECT credited_minor FROM funding_events WHERE card_id = $1`,
    [cardId],
  );

  // Known all-in costs; count the ones that are not yet determinable.
  const knownCosts: Money[] = [];
  let unknownCost = 0;
  let pendingTotal = 0n;
  let settledTotal = 0n;
  const today = riyadhDate(new Date().toISOString());
  let todaySar = 0n;
  for (const row of wdRes.rows) {
    if (row.state === 'DRAFT' || row.state === 'REVERSED') continue;
    if (riyadhDate(new Date(row.transaction_at).toISOString()) === today) {
      todaySar += BigInt(row.dispensed_sar_minor);
    }
    if (row.posted_debit_minor) {
      let allIn = BigInt(row.posted_debit_minor);
      for (const f of [row.posted_bank_fee_minor, row.posted_international_fee_minor, row.posted_cash_withdrawal_fee_minor, row.posted_other_fee_minor]) {
        if (f) allIn += BigInt(f);
      }
      knownCosts.push({ minor: allIn, currency: card.nativeCurrency });
      settledTotal += allIn;
    } else if (row.pending_debit_minor) {
      pendingTotal += BigInt(row.pending_debit_minor) + BigInt(row.pending_fee_minor ?? '0');
      unknownCost += 1;
    } else {
      unknownCost += 1;
    }
  }

  const opening = moneyFrom(cardRow.opening_available_minor, cardRow.native_currency);
  const ledger = opening
    ? computeCardLedger({
        card,
        openingAvailable: opening,
        fundingCredits: fundRes.rows.map((r) => ({ minor: BigInt(r.credited_minor), currency: card.nativeCurrency })),
        knownCosts,
        withdrawalsWithUnknownCost: unknownCost,
        lastConfirmed: observationFrom(snapRes.rows[0]),
      })
    : null;

  const { evidence } = await evidenceForCards(db, cardRow.trip_id ?? '');
  const mine = evidence.find((e) => e.card.id === cardId);
  const ranking = mine ? rankCards([mine]) : null;
  const rank = ranking?.ranked[0] ?? ranking?.notComparable[0] ?? null;

  const dailyLimit = moneyFrom(cardRow.daily_atm_limit_minor, cardRow.daily_atm_limit_currency ?? cardRow.native_currency);

  return {
    card: { ...card, isActive: cardRow.is_active, notes: cardRow.notes },
    openingBalance: opening ? toWire(opening) : null,
    expectedLedgerBalance: ledger ? evidencedToWire(ledger.expectedLedgerBalance) : { known: false, reason: 'No opening balance recorded for this card.', missing: ['Opening balance'] },
    lastConfirmedBankBalance: ledger ? evidencedToWire(ledger.lastConfirmedBankBalance) : (snapRes.rows[0] ? evidencedToWire({ known: true, value: { minor: BigInt(snapRes.rows[0].amount_minor), currency: card.nativeCurrency }, provenance: 'BANK_APP', confidence: 'OBSERVED', basis: 'Latest snapshot' }) : { known: false, reason: 'No balance confirmed yet.', missing: ['A balance snapshot'] }),
    reconciliationDifference: ledger ? evidencedToWire(ledger.reconciliationDifference) : { known: false, reason: 'No opening balance recorded for this card.', missing: ['Opening balance'] },
    hasUnexplainedDifference: ledger?.hasUnexplainedDifference ?? false,
    todaySarWithdrawnMinor: todaySar.toString(),
    dailyLimit: dailyLimit ? toWire(dailyLimit) : null,
    remainingTodayMinor: dailyLimit && dailyLimit.currency === 'SAR' ? (dailyLimit.minor - todaySar > 0n ? (dailyLimit.minor - todaySar).toString() : '0') : null,
    pendingTotalMinor: pendingTotal.toString(),
    settledTotalMinor: settledTotal.toString(),
    nativeCurrency: card.nativeCurrency,
    verifiedAverageRate: rank?.averageIqdPerSar ? { display: rateToDecimalString(rank.averageIqdPerSar, 2), label: formatRate(rank.averageIqdPerSar, 2) } : null,
    lastSettledRate: rank?.lastSettledIqdPerSar ? { display: rateToDecimalString(rank.lastSettledIqdPerSar, 2) } : null,
    sampleCount: rank?.usableSampleCount ?? 0,
    dataConfidence: rank?.confidence ?? 'NONE',
    comparableInIqd: rank?.comparable ?? false,
    confidenceReason: rank?.reason ?? 'No data yet.',
    withdrawalCount: wdRes.rows.length,
  };
}

export async function comparisonView(db: Db, tripId: string) {
  const { evidence, extras } = await evidenceForCards(db, tripId);
  const rows = buildComparison(evidence, extras);
  const ranking = rankCards(evidence);
  return {
    message: ranking.message,
    best: ranking.best
      ? {
          cardId: ranking.best.card.id,
          nickname: ranking.best.card.nickname,
          averageIqdPerSar: rateToDecimalString(ranking.best.averageIqdPerSar!, 2),
          sampleCount: ranking.best.usableSampleCount,
          confidence: ranking.best.confidence,
        }
      : null,
    rows: rows.map((r) => ({
      cardId: r.card.id,
      nickname: r.card.nickname,
      issuer: r.card.issuer,
      ownership: r.card.ownership,
      nativeCurrency: r.nativeCurrency,
      lastSettledNativePerSar: r.lastSettledNativePerSar ? rateToDecimalString(r.lastSettledNativePerSar, 4) : null,
      rollingAverageNativePerSar: r.rollingAverageNativePerSar ? rateToDecimalString(r.rollingAverageNativePerSar, 4) : null,
      lastSettledIqdPerSar: r.lastSettledIqdPerSar ? rateToDecimalString(r.lastSettledIqdPerSar, 2) : null,
      rollingAverageIqdPerSar: r.rollingAverageIqdPerSar ? rateToDecimalString(r.rollingAverageIqdPerSar, 2) : null,
      totalFees: toDecimalString(r.totalFeesNative) + ' ' + r.nativeCurrency,
      dccUsedCount: r.dccUsedCount,
      atmOperators: r.atmOperators,
      sampleCount: r.sampleCount,
      confidence: r.confidence,
      comparableInIqd: r.comparableInIqd,
    })),
  };
}

export async function plannerView(db: Db, tripId: string, targetSarMinor: unknown, ownership: 'ALL' | 'PERSONAL' | 'COMPANY') {
  const target = parseMinor(targetSarMinor, 'target SAR');
  const { evidence, cards } = await evidenceForCards(db, tripId);
  const today = riyadhDate(new Date().toISOString());

  const plannerCards: PlannerCard[] = [];
  for (const cardRow of cards) {
    const card = cardRefFrom(cardRow);
    const snapRes = await db.query<SnapshotRow>(
      `SELECT * FROM balance_snapshots WHERE card_id = $1 ORDER BY captured_at DESC LIMIT 1`,
      [cardRow.id],
    );
    const available = snapRes.rows[0]
      ? { minor: BigInt(snapRes.rows[0].amount_minor), currency: card.nativeCurrency }
      : moneyFrom(cardRow.opening_available_minor, cardRow.native_currency);

    const mine = evidence.find((e) => e.card.id === cardRow.id);
    // For capacity planning, the most recent reconciled native rate is enough
    // even when the economic IQD rate is not knowable.
    const verifiedNative = (() => {
      const obs = mine?.observations.filter((o) => o.isReconciled) ?? [];
      if (obs.length === 0) return null;
      const last = obs[obs.length - 1];
      return last ? last.nativePerSar : null;
    })();

    let referenceNative: Rate | null = null;
    if (!verifiedNative) {
      if (card.nativeCurrency === 'IQD') {
        const ref = await latestReferenceRate(db, 'SAR', 'IQD');
        if (ref) referenceNative = rateFromDecimal(ref.rate, 'SAR', 'IQD');
      } else {
        const ref = await latestReferenceRate(db, 'SAR', card.nativeCurrency);
        if (ref) referenceNative = rateFromDecimal(ref.rate, 'SAR', card.nativeCurrency);
      }
    }

    const todaySarRes = await db.query<{ t: string; at: string }>(
      `SELECT dispensed_sar_minor::text AS t, transaction_at::text AS at FROM withdrawals
        WHERE card_id = $1 AND state NOT IN ('DRAFT','REVERSED','FAILED_ATM')`,
      [cardRow.id],
    );
    let withdrawnToday = 0n;
    for (const r of todaySarRes.rows) {
      if (riyadhDate(new Date(r.at).toISOString()) === today) withdrawnToday += BigInt(r.t);
    }

    const pendRes = await db.query<{ p: string }>(
      `SELECT coalesce(sum(pending_debit_minor + coalesce(pending_fee_minor,0)),0)::text AS p
         FROM withdrawals WHERE card_id = $1 AND posted_debit_minor IS NULL AND pending_debit_minor IS NOT NULL`,
      [cardRow.id],
    );

    plannerCards.push({
      card,
      availableNative: available,
      dailyAtmLimit: moneyFrom(cardRow.daily_atm_limit_minor, cardRow.daily_atm_limit_currency ?? card.nativeCurrency),
      perTransactionLimit: moneyFrom(cardRow.per_transaction_limit_minor, cardRow.per_transaction_limit_currency ?? card.nativeCurrency),
      regulatoryMonthlyRemaining: moneyFrom(cardRow.intl_monthly_limit_minor, cardRow.intl_monthly_limit_currency ?? card.nativeCurrency),
      withdrawnTodaySar: { minor: withdrawnToday, currency: 'SAR' },
      verifiedNativePerSar: verifiedNative,
      referenceNativePerSar: referenceNative,
      pendingNative: { minor: BigInt(pendRes.rows[0]?.p ?? '0'), currency: card.nativeCurrency },
    });
  }

  const plan = planWithdrawals({ minor: target, currency: 'SAR' }, plannerCards, { ownership });
  return {
    targetSarMinor: target.toString(),
    allocations: plan.allocations.map((a) => ({
      cardId: a.card.id,
      nickname: a.card.nickname,
      ownership: a.card.ownership,
      sarMinor: a.sar.minor.toString(),
      sarDisplay: format(a.sar),
      withdrawalCount: a.withdrawalCount,
      perWithdrawalSarMinor: a.perWithdrawalSar.minor.toString(),
      estimatedCostNative: evidencedToWire(a.estimatedCostNative),
      rateBasis: a.rateBasis,
      bindingConstraint: a.bindingConstraint,
      notes: a.notes,
    })),
    allocatedSarMinor: plan.allocatedSar.minor.toString(),
    shortfallSarMinor: plan.shortfallSar.minor.toString(),
    unusable: plan.unusable.map((u) => ({ cardId: u.card.id, nickname: u.card.nickname, reason: u.reason })),
    totalEstimatedCostIqd: evidencedToWire(plan.totalEstimatedCostIqd),
    disclaimer: plan.disclaimer,
    overallConfidence: plan.overallConfidence,
  };
}

export async function withdrawalDetail(db: Db, id: string) {
  const { row, input, computation, reconciliation } = await evaluateWithdrawal(db, id);
  const discRes = await db.query(
    `SELECT id, expected_minor::text AS expected_minor, observed_minor::text AS observed_minor,
            difference_minor::text AS difference_minor, currency, potential_causes, user_classification, resolution_note
       FROM discrepancies WHERE withdrawal_id = $1 ORDER BY created_at DESC`,
    [id],
  );
  const revRes = await db.query(
    `SELECT field, previous_value, new_value, changed_at::text AS changed_at, reason FROM withdrawal_revisions WHERE withdrawal_id = $1 ORDER BY changed_at`,
    [id],
  );
  return {
    id: row.id,
    state: row.state,
    card: input.card,
    ownership: row.ownership,
    transactionAt: input.transactionAt,
    transactionLocalTime: row.transaction_local_time,
    postingDate: row.posting_date ? new Date(row.posting_date).toISOString().slice(0, 10) : null,
    atm: {
      operator: row.atm_operator, location: row.atm_location, terminalId: row.atm_terminal_id,
      reference: row.transaction_reference,
    },
    requestedSarMinor: str(row.requested_sar_minor),
    dispensedSarMinor: str(row.dispensed_sar_minor),
    dcc: { offered: row.dcc_offered, selection: row.dcc_selection },
    surcharge: row.atm_surcharge_minor
      ? { minor: str(row.atm_surcharge_minor), currency: row.atm_surcharge_currency, handling: row.surcharge_handling }
      : null,
    before: input.before ? { amountMinor: input.before.amount.minor.toString(), currency: input.before.amount.currency, source: input.before.source, balanceType: input.before.balanceType, capturedAt: input.before.capturedAt } : null,
    after: input.after ? { amountMinor: input.after.amount.minor.toString(), currency: input.after.amount.currency, source: input.after.source, balanceType: input.after.balanceType, capturedAt: input.after.capturedAt } : null,
    pending: input.pending ? { debitMinor: input.pending.debit.minor.toString(), feeMinor: input.pending.fee?.minor.toString() ?? null, description: input.pending.description, at: input.pending.at } : null,
    posted: input.posted ? {
      debitMinor: input.posted.debit.minor.toString(),
      bankFeeMinor: input.posted.bankFee?.minor.toString() ?? null,
      internationalFeeMinor: input.posted.internationalFee?.minor.toString() ?? null,
      cashWithdrawalFeeMinor: input.posted.cashWithdrawalFee?.minor.toString() ?? null,
      otherFeeMinor: input.posted.otherFee?.minor.toString() ?? null,
      statementDescription: input.posted.statementDescription,
      postedAt: input.posted.postedAt,
    } : null,
    computation: {
      observedBalanceDelta: evidencedToWire(computation.observedBalanceDelta),
      pendingDebitTotal: evidencedToWire(computation.pendingDebitTotal),
      postedDebitTotal: evidencedToWire(computation.postedDebitTotal),
      issuerFees: evidencedToWire(computation.issuerFees),
      atmOperatorFee: evidencedToWire(computation.atmOperatorFee),
      nativeAllInCost: evidencedToWire(computation.nativeAllInCost),
      effectiveNativePerSar: evidencedRateToWire(computation.effectiveNativePerSar),
      referenceIqdCost: evidencedToWire(computation.referenceIqdCost),
      economicIqdCost: evidencedToWire(computation.economicIqdCost),
      verifiedIqdPerSar: evidencedRateToWire(computation.verifiedIqdPerSar),
      costBasis: computation.costBasis,
      warnings: computation.warnings,
    },
    reconciliation: {
      expectedAfterBalance: evidencedToWire(reconciliation.expectedAfterBalance),
      observedAfterBalance: evidencedToWire(reconciliation.observedAfterBalance),
      difference: evidencedToWire(reconciliation.difference),
      isReconciled: reconciliation.isReconciled,
      potentialCauses: reconciliation.potentialCauses,
      suggestedState: reconciliation.suggestedState,
      explanation: reconciliation.explanation,
      explanationCode: reconciliation.explanationCode,
    },
    discrepancies: discRes.rows,
    revisions: revRes.rows,
    notes: row.notes,
    dayCloseId: row.day_close_id,
  };
}

export async function dayCloseView(db: Db, tripId: string, date: string) {
  const cardsRes = await db.query<CardRow>(`SELECT * FROM cards WHERE trip_id = $1 AND is_active`, [tripId]);
  const perCard = [];
  for (const cardRow of cardsRes.rows) {
    const dash = await cardDashboard(db, cardRow.id);
    if (!dash) continue;
    const wds = await db.query<{ id: string; state: string; dispensed: string; at: string }>(
      `SELECT id, state, dispensed_sar_minor::text AS dispensed, transaction_at::text AS at FROM withdrawals WHERE card_id = $1`,
      [cardRow.id],
    );
    let daySar = 0n;
    let pendingCount = 0;
    let unsettledCount = 0;
    for (const w of wds.rows) {
      if (riyadhDate(new Date(w.at).toISOString()) === date) daySar += BigInt(w.dispensed);
      if (w.state === 'PENDING') pendingCount += 1;
      if (['CAPTURED', 'PENDING', 'PARTIAL_DISPENSE', 'DISCREPANCY'].includes(w.state)) unsettledCount += 1;
    }
    perCard.push({
      cardId: cardRow.id,
      nickname: cardRow.nickname,
      nativeCurrency: cardRow.native_currency,
      lastConfirmedBankBalance: dash.lastConfirmedBankBalance,
      expectedLedgerBalance: dash.expectedLedgerBalance,
      reconciliationDifference: dash.reconciliationDifference,
      pendingCount,
      unsettledCount,
      daySarWithdrawnMinor: daySar.toString(),
      dailyLimit: dash.dailyLimit,
    });
  }
  const movements = await movementsForTrip(db, tripId);
  const treasury = treasurySummary(movements);
  const closeRes = await db.query<{ id: string; status: string; closed_at: string | null }>(
    `SELECT id, status, closed_at::text AS closed_at FROM day_closes WHERE trip_id=$1 AND close_date=$2`,
    [tripId, date],
  );
  return {
    date,
    status: closeRes.rows[0]?.status ?? 'OPEN',
    closedAt: closeRes.rows[0]?.closed_at ?? null,
    cards: perCard,
    wallets: {
      personal: {
        received: toWire(treasury.personal.received),
        spent: toWire(treasury.personal.spent),
        expectedOnHand: toWire(treasury.personal.expectedOnHand),
      },
      company: {
        received: toWire(treasury.company.received),
        spent: toWire(treasury.company.spent),
        expectedOnHand: toWire(treasury.company.expectedOnHand),
      },
    },
  };
}
