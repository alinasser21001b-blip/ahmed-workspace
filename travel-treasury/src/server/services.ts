import { computeWithdrawal, fundingBasisFrom, type WithdrawalInput } from '../core/withdrawal.ts';
import { reconcileWithdrawal } from '../core/reconcile.ts';
import { assertTransition, type WithdrawalState } from '../core/states.ts';
import { findDuplicates, highestRisk } from '../core/duplicate.ts';
import { rateFromDecimal, type Rate } from '../core/rate.ts';
import type { Db } from './db/db.ts';
import type { AuthedUser } from './auth.ts';
import {
  badRequest, conflict, newId, notFound, oneOf, optionalMinor, optionalOneOf, optionalString,
  parseMinor, requireString, riyadhDate, riyadhLocalTime,
} from './util.ts';
import {
  cardRefFrom, fundingEventsFor, getCardRow, getWithdrawalRow, latestReferenceRate,
  withdrawalInputFrom, type WithdrawalRow,
} from './repo.ts';

/**
 * Every financial write here follows the same shape: one transaction that
 * writes the financial event, its ledger effects, and its audit record — all
 * or nothing. There is deliberately no helper that writes a monetary row
 * outside a transaction.
 */
export async function audit(
  tx: Db,
  actor: string | null,
  action: string,
  entityTable: string,
  entityId: string,
  previous: unknown,
  next: unknown,
  reason?: string | null,
  requestId?: string | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (id, actor_user_id, action, entity_table, entity_id, previous_value, new_value, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      newId('aud'), actor, action, entityTable, entityId,
      previous === undefined ? null : JSON.stringify(previous),
      next === undefined ? null : JSON.stringify(next),
      reason ?? null, requestId ?? null,
    ],
  );
}

export async function ensureTripAndWallets(db: Db): Promise<{ tripId: string }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM trips WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
  );
  if (existing.rows[0]) return { tripId: existing.rows[0].id };
  const tripId = newId('trip');
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO trips (id, name, destination, start_date) VALUES ($1, $2, 'Saudi Arabia', CURRENT_DATE)`,
      [tripId, 'Saudi Arabia trip'],
    );
    await tx.query(
      `INSERT INTO cash_wallets (id, trip_id, ownership) VALUES ($1,$3,'PERSONAL'), ($2,$3,'COMPANY')`,
      [newId('wal'), newId('wal'), tripId],
    );
    await audit(tx, null, 'TRIP_CREATED', 'trips', tripId, null, { name: 'Saudi Arabia trip' });
  });
  return { tripId };
}

async function walletId(tx: Db, tripId: string, ownership: 'PERSONAL' | 'COMPANY'): Promise<string> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM cash_wallets WHERE trip_id = $1 AND ownership = $2`,
    [tripId, ownership],
  );
  const row = res.rows[0];
  if (!row) throw notFound(`No ${ownership} wallet for trip ${tripId}`);
  return row.id;
}

// ------------------------------------------------------------ snapshots ----

export interface SnapshotBody {
  amountMinor: unknown; source: unknown; balanceType: unknown; capturedAt?: unknown; notes?: unknown;
}

export async function insertSnapshot(
  tx: Db,
  user: AuthedUser,
  cardId: string,
  currency: string,
  body: SnapshotBody,
  timeZone: string,
): Promise<string> {
  const id = newId('snap');
  const capturedAt =
    typeof body.capturedAt === 'string' && body.capturedAt ? new Date(body.capturedAt).toISOString() : new Date().toISOString();
  await tx.query(
    `INSERT INTO balance_snapshots (id, card_id, amount_minor, currency, captured_at, captured_local_time, source, balance_type, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id, cardId, parseMinor(body.amountMinor, 'balance amount').toString(), currency,
      capturedAt, riyadhLocalTime(capturedAt, timeZone),
      oneOf(body.source, ['BANK_APP', 'SMS', 'ATM_RECEIPT', 'STATEMENT', 'MANUAL'] as const, 'balance source'),
      oneOf(body.balanceType, ['AVAILABLE', 'LEDGER', 'UNKNOWN'] as const, 'balance type'),
      optionalString(body.notes, 'notes'), user.id,
    ],
  );
  return id;
}

// ---------------------------------------------------------- withdrawals ----

export interface CreateWithdrawalBody {
  idempotencyKey: unknown;
  cardId: unknown;
  transactionAt?: unknown;
  requestedSarMinor?: unknown;
  dispensedSarMinor: unknown;
  atmOperator?: unknown; atmLocation?: unknown; atmTerminalId?: unknown; transactionReference?: unknown;
  atmSurchargeMinor?: unknown; atmSurchargeCurrency?: unknown; surchargeHandling?: unknown;
  dccOffered?: unknown; dccSelection?: unknown;
  before?: SnapshotBody | null; after?: SnapshotBody | null;
  state?: unknown;
  notes?: unknown;
  duplicateWarningAck?: unknown;
}

export interface CreateWithdrawalResult {
  id: string;
  created: boolean;
  duplicateWarning: { risk: string; findings: { existingId: string; reasons: readonly string[] }[] } | null;
}

export async function createWithdrawal(
  db: Db,
  user: AuthedUser,
  body: CreateWithdrawalBody,
): Promise<CreateWithdrawalResult> {
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotencyKey', 200);
  const cardId = requireString(body.cardId, 'cardId', 100);

  // Idempotent replay: the same key returns the original row, creating nothing.
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM withdrawals WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false, duplicateWarning: null };

  const cardRow = await getCardRow(db, cardId);
  if (!cardRow.is_active) throw badRequest('This card is inactive', 'هذه البطاقة غير مفعّلة');
  const tripId = cardRow.trip_id ?? (await ensureTripAndWallets(db)).tripId;
  const tzRes = await db.query<{ local_timezone: string }>(`SELECT local_timezone FROM trips WHERE id = $1`, [tripId]);
  const timeZone = tzRes.rows[0]?.local_timezone ?? 'Asia/Riyadh';

  const dispensed = parseMinor(body.dispensedSarMinor, 'dispensed SAR');
  if (dispensed < 0n) throw badRequest('Cash dispensed cannot be negative', 'المبلغ المستلم لا يمكن أن يكون سالبًا');
  const transactionAt =
    typeof body.transactionAt === 'string' && body.transactionAt
      ? new Date(body.transactionAt).toISOString()
      : new Date().toISOString();

  // Advisory duplicate check — warns, never blocks, unless unacknowledged.
  const recent = await db.query<{
    id: string; card_id: string; dispensed_sar_minor: string; transaction_at: string;
    atm_terminal_id: string | null; atm_operator: string | null; transaction_reference: string | null;
  }>(
    `SELECT id, card_id, dispensed_sar_minor, transaction_at, atm_terminal_id, atm_operator, transaction_reference
       FROM withdrawals WHERE card_id = $1 AND transaction_at > $2::timestamptz - interval '2 hours' AND transaction_at < $2::timestamptz + interval '2 hours'`,
    [cardId, transactionAt],
  );
  const findings = findDuplicates(
    {
      cardId,
      dispensedSar: { minor: dispensed, currency: 'SAR' },
      transactionAt,
      atmTerminalId: optionalString(body.atmTerminalId, 'atmTerminalId', 100),
      atmOperator: optionalString(body.atmOperator, 'atmOperator', 200),
      transactionReference: optionalString(body.transactionReference, 'transactionReference', 200),
    },
    recent.rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      dispensedSar: { minor: BigInt(r.dispensed_sar_minor), currency: 'SAR' as const },
      transactionAt: new Date(r.transaction_at).toISOString(),
      atmTerminalId: r.atm_terminal_id,
      atmOperator: r.atm_operator,
      transactionReference: r.transaction_reference,
    })),
  );
  const risk = highestRisk(findings);
  if ((risk === 'HIGH' || risk === 'CERTAIN') && body.duplicateWarningAck !== true) {
    return {
      id: '',
      created: false,
      duplicateWarning: {
        risk,
        findings: findings.map((f) => ({ existingId: f.existingId, reasons: f.reasons })),
      },
    };
  }

  const requested = optionalMinor(body.requestedSarMinor, 'requested SAR');
  const stateInput = optionalOneOf(
    body.state,
    ['CAPTURED', 'FAILED_ATM', 'PARTIAL_DISPENSE', 'DRAFT'] as const,
    'state',
  );
  let state: WithdrawalState = stateInput ?? 'CAPTURED';
  if (dispensed === 0n && state !== 'DRAFT') state = 'FAILED_ATM';
  else if (requested !== null && requested !== dispensed && dispensed > 0n && state === 'CAPTURED')
    state = 'PARTIAL_DISPENSE';

  const id = newId('wd');
  await db.transaction(async (tx) => {
    let beforeId: string | null = null;
    let afterId: string | null = null;
    if (body.before && body.before.amountMinor !== undefined && body.before.amountMinor !== null && body.before.amountMinor !== '') {
      beforeId = await insertSnapshot(tx, user, cardId, cardRow.native_currency, body.before, timeZone);
    }
    if (body.after && body.after.amountMinor !== undefined && body.after.amountMinor !== null && body.after.amountMinor !== '') {
      afterId = await insertSnapshot(tx, user, cardId, cardRow.native_currency, body.after, timeZone);
    }

    await tx.query(
      `INSERT INTO withdrawals (
         id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, transaction_local_time,
         atm_operator, atm_location, atm_terminal_id, transaction_reference,
         requested_sar_minor, dispensed_sar_minor, atm_surcharge_minor, atm_surcharge_currency, surcharge_handling,
         dcc_offered, dcc_selection, before_snapshot_id, after_snapshot_id, notes, duplicate_warning_ack, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        id, idempotencyKey, tripId, cardId, cardRow.ownership, state,
        transactionAt, riyadhLocalTime(transactionAt, timeZone),
        optionalString(body.atmOperator, 'atmOperator', 200),
        optionalString(body.atmLocation, 'atmLocation', 500),
        optionalString(body.atmTerminalId, 'atmTerminalId', 100),
        optionalString(body.transactionReference, 'transactionReference', 200),
        requested?.toString() ?? null,
        dispensed.toString(),
        optionalMinor(body.atmSurchargeMinor, 'ATM surcharge')?.toString() ?? null,
        optionalString(body.atmSurchargeCurrency, 'surcharge currency', 3),
        optionalOneOf(body.surchargeHandling, ['INCLUDED_IN_DEBIT', 'POSTED_SEPARATELY', 'UNKNOWN'] as const, 'surchargeHandling') ?? 'UNKNOWN',
        optionalOneOf(body.dccOffered, ['YES', 'NO', 'UNKNOWN'] as const, 'dccOffered') ?? 'UNKNOWN',
        optionalOneOf(body.dccSelection, ['LOCAL_CURRENCY', 'BILLING_CURRENCY', 'UNKNOWN'] as const, 'dccSelection'),
        beforeId, afterId,
        optionalString(body.notes, 'notes'),
        body.duplicateWarningAck === true,
        user.id,
      ],
    );

    // Ledger effect: physical cash enters the wallet matching the CARD's
    // ownership. The database trigger re-checks this; the service never
    // chooses a wallet by request input.
    if (dispensed > 0n) {
      const wid = await walletId(tx, tripId, cardRow.ownership);
      await tx.query(
        `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, notes, created_by)
         VALUES ($1,$2,'IN',$3,'ATM_WITHDRAWAL',$4,$5,$6,$7)`,
        [
          newId('cm'), wid, dispensed.toString(), id, transactionAt,
          cardRow.ownership === 'COMPANY' ? 'Company cash withdrawn (transfer, not expense)' : 'Personal cash withdrawn',
          user.id,
        ],
      );
    }

    await audit(tx, user.id, 'WITHDRAWAL_CREATED', 'withdrawals', id, null, {
      cardId, state, dispensedSarMinor: dispensed.toString(), transactionAt,
    });
  });

  return {
    id,
    created: true,
    duplicateWarning:
      findings.length > 0
        ? { risk, findings: findings.map((f) => ({ existingId: f.existingId, reasons: f.reasons })) }
        : null,
  };
}

// -------------------------------------------------- pending & settlement ----

export async function recordPending(
  db: Db,
  user: AuthedUser,
  withdrawalId: string,
  body: { pendingDebitMinor: unknown; pendingFeeMinor?: unknown; description?: unknown; pendingAt?: unknown; reason?: unknown },
): Promise<void> {
  const row = await getWithdrawalRow(db, withdrawalId);
  const debit = parseMinor(body.pendingDebitMinor, 'pending debit');
  const fee = optionalMinor(body.pendingFeeMinor, 'pending fee');
  const at =
    typeof body.pendingAt === 'string' && body.pendingAt ? new Date(body.pendingAt).toISOString() : new Date().toISOString();
  const card = await getCardRow(db, row.card_id);

  await db.transaction(async (tx) => {
    if (row.pending_debit_minor === null) {
      assertTransition(row.state, 'PENDING');
      await tx.query(
        `UPDATE withdrawals SET pending_debit_minor=$2, pending_debit_currency=$3, pending_fee_minor=$4,
                pending_description=$5, pending_at=$6, state='PENDING', updated_at=now() WHERE id=$1`,
        [withdrawalId, debit.toString(), card.native_currency, fee?.toString() ?? null,
         optionalString(body.description, 'description'), at],
      );
      await audit(tx, user.id, 'PENDING_RECORDED', 'withdrawals', withdrawalId, null, {
        pendingDebitMinor: debit.toString(), pendingFeeMinor: fee?.toString() ?? null,
      });
    } else {
      // Revision path: the original pending figures stay in history, the
      // change carries a reason, and the trigger is told this update is the
      // audited one. Everything commits together or not at all.
      const reason = requireString(body.reason ?? 'Pending amount revised', 'reason', 500);
      await tx.query(`SELECT set_config('app.allow_pending_revision', 'on', true)`);
      await tx.query(
        `INSERT INTO withdrawal_revisions (id, withdrawal_id, field, previous_value, new_value, changed_by, reason)
         VALUES ($1,$2,'pending_debit_minor',$3,$4,$5,$6)`,
        [newId('rev'), withdrawalId, row.pending_debit_minor, debit.toString(), user.id, reason],
      );
      if ((fee?.toString() ?? null) !== row.pending_fee_minor) {
        await tx.query(
          `INSERT INTO withdrawal_revisions (id, withdrawal_id, field, previous_value, new_value, changed_by, reason)
           VALUES ($1,$2,'pending_fee_minor',$3,$4,$5,$6)`,
          [newId('rev'), withdrawalId, row.pending_fee_minor, fee?.toString() ?? null, user.id, reason],
        );
      }
      await tx.query(
        `UPDATE withdrawals SET pending_debit_minor=$2, pending_fee_minor=$3, pending_description=$4, pending_at=$5, updated_at=now() WHERE id=$1`,
        [withdrawalId, debit.toString(), fee?.toString() ?? null, optionalString(body.description, 'description') ?? row.pending_description, at],
      );
      await audit(tx, user.id, 'PENDING_REVISED', 'withdrawals', withdrawalId,
        { pendingDebitMinor: row.pending_debit_minor }, { pendingDebitMinor: debit.toString() }, reason);
    }
  });
}

export async function recordSettlement(
  db: Db,
  user: AuthedUser,
  withdrawalId: string,
  body: {
    postedDebitMinor: unknown; postedBankFeeMinor?: unknown; postedInternationalFeeMinor?: unknown;
    postedCashWithdrawalFeeMinor?: unknown; postedOtherFeeMinor?: unknown;
    statementDescription?: unknown; postedAt?: unknown; postingDate?: unknown; transactionDate?: unknown;
  },
): Promise<void> {
  const row = await getWithdrawalRow(db, withdrawalId);
  const card = await getCardRow(db, row.card_id);
  const debit = parseMinor(body.postedDebitMinor, 'posted debit');
  const postedAt =
    typeof body.postedAt === 'string' && body.postedAt ? new Date(body.postedAt).toISOString() : new Date().toISOString();
  assertTransition(row.state, 'POSTED');

  await db.transaction(async (tx) => {
    // Settlement lands beside the pending figures; it never touches them.
    await tx.query(
      `UPDATE withdrawals SET posted_debit_minor=$2, posted_debit_currency=$3, posted_bank_fee_minor=$4,
              posted_international_fee_minor=$5, posted_cash_withdrawal_fee_minor=$6, posted_other_fee_minor=$7,
              statement_description=$8, posted_at=$9, posting_date=$10, state='POSTED', updated_at=now()
       WHERE id=$1`,
      [
        withdrawalId, debit.toString(), card.native_currency,
        optionalMinor(body.postedBankFeeMinor, 'bank fee')?.toString() ?? null,
        optionalMinor(body.postedInternationalFeeMinor, 'international fee')?.toString() ?? null,
        optionalMinor(body.postedCashWithdrawalFeeMinor, 'cash withdrawal fee')?.toString() ?? null,
        optionalMinor(body.postedOtherFeeMinor, 'other fee')?.toString() ?? null,
        optionalString(body.statementDescription, 'statement description'),
        postedAt,
        typeof body.postingDate === 'string' && body.postingDate ? body.postingDate : postedAt.slice(0, 10),
      ],
    );
    await audit(tx, user.id, 'SETTLEMENT_RECORDED', 'withdrawals', withdrawalId,
      { pendingDebitMinor: row.pending_debit_minor },
      { postedDebitMinor: debit.toString() });
  });
}

// --------------------------------------------- reconciliation lifecycle ----

export async function evaluateWithdrawal(db: Db, withdrawalId: string) {
  const row = await getWithdrawalRow(db, withdrawalId);
  const input = await withdrawalInputFrom(db, row);
  const funding = fundingBasisFrom(await fundingEventsFor(db, row.card_id), input.card.nativeCurrency);
  let referenceRate: Rate | null = null;
  let referenceRateLabel: string | undefined;
  if (input.card.nativeCurrency !== 'IQD') {
    const ref = await latestReferenceRate(db, input.card.nativeCurrency, 'IQD');
    if (ref) {
      referenceRate = rateFromDecimal(ref.rate, input.card.nativeCurrency, 'IQD');
      referenceRateLabel = `${ref.rateType} ${ref.rate} IQD/${input.card.nativeCurrency} (${ref.effectiveDate})`;
    }
  }
  const computation = computeWithdrawal(input, { funding, referenceRate, referenceRateLabel });
  const reconciliation = reconcileWithdrawal(input, computation);
  return { row, input, computation, reconciliation };
}

export async function applyReconciliation(db: Db, user: AuthedUser, withdrawalId: string): Promise<{ state: WithdrawalState }> {
  const { row, computation, reconciliation } = await evaluateWithdrawal(db, withdrawalId);
  const target = reconciliation.suggestedState;
  if (target === row.state) return { state: row.state };
  assertTransition(row.state, target);

  await db.transaction(async (tx) => {
    await tx.query(`UPDATE withdrawals SET state=$2, updated_at=now() WHERE id=$1`, [withdrawalId, target]);
    if (target === 'DISCREPANCY' && reconciliation.difference.known && reconciliation.expectedAfterBalance.known && reconciliation.observedAfterBalance.known) {
      await tx.query(
        `INSERT INTO discrepancies (id, withdrawal_id, expected_minor, observed_minor, difference_minor, currency, confidence, potential_causes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId('disc'), withdrawalId,
          reconciliation.expectedAfterBalance.value.minor.toString(),
          reconciliation.observedAfterBalance.value.minor.toString(),
          reconciliation.difference.value.minor.toString(),
          reconciliation.difference.value.currency,
          computation.costBasis,
          JSON.stringify(reconciliation.potentialCauses),
        ],
      );
    }
    await audit(tx, user.id, 'RECONCILIATION_APPLIED', 'withdrawals', withdrawalId,
      { state: row.state }, { state: target, explanation: reconciliation.explanation });
  });
  return { state: target };
}

export async function classifyDiscrepancy(
  db: Db,
  user: AuthedUser,
  discrepancyId: string,
  body: { classification: unknown; resolutionNote?: unknown },
): Promise<void> {
  const classification = oneOf(
    body.classification,
    ['PENDING_HOLD','SEPARATE_ISSUER_FEE','ATM_SURCHARGE','OTHER_TRANSACTION','DELAYED_BALANCE_REFRESH','DCC','REVERSAL','ENTRY_ERROR','UNKNOWN'] as const,
    'classification',
  );
  const res = await db.query<{ id: string; withdrawal_id: string; user_classification: string | null }>(
    `SELECT id, withdrawal_id, user_classification FROM discrepancies WHERE id = $1`,
    [discrepancyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Discrepancy not found');
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE discrepancies SET user_classification=$2, classified_by=$3, classified_at=now(), resolution_note=$4 WHERE id=$1`,
      [discrepancyId, classification, user.id, optionalString(body.resolutionNote, 'resolution note')],
    );
    await audit(tx, user.id, 'DISCREPANCY_CLASSIFIED', 'discrepancies', discrepancyId,
      { classification: row.user_classification }, { classification });
  });
}

export async function reverseWithdrawal(
  db: Db,
  user: AuthedUser,
  withdrawalId: string,
  body: { reason: unknown; reversedAmountMinor?: unknown },
): Promise<void> {
  const row = await getWithdrawalRow(db, withdrawalId);
  const reason = requireString(body.reason, 'reason', 500);
  assertTransition(row.state, 'REVERSED');
  await db.transaction(async (tx) => {
    // The original event is never deleted; the state records the reversal and
    // the audit row carries the amounts.
    await tx.query(`UPDATE withdrawals SET state='REVERSED', updated_at=now() WHERE id=$1`, [withdrawalId]);
    await audit(tx, user.id, 'WITHDRAWAL_REVERSED', 'withdrawals', withdrawalId,
      { state: row.state, postedDebitMinor: row.posted_debit_minor },
      { state: 'REVERSED', reversedAmountMinor: optionalMinor(body.reversedAmountMinor, 'reversed amount')?.toString() ?? row.posted_debit_minor },
      reason);
  });
}

// ----------------------------------------------------------- daily close ----

export async function closeDay(
  db: Db,
  user: AuthedUser,
  tripId: string,
  closeDate: string,
  snapshot: unknown,
): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) throw badRequest('closeDate must be YYYY-MM-DD');
  const existing = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM day_closes WHERE trip_id=$1 AND close_date=$2`,
    [tripId, closeDate],
  );
  if (existing.rows[0]?.status === 'CLOSED') {
    throw conflict('This day is already closed', 'هذا اليوم مُقفل مسبقًا');
  }
  const id = existing.rows[0]?.id ?? newId('day');
  const tzRes = await db.query<{ local_timezone: string }>(`SELECT local_timezone FROM trips WHERE id = $1`, [tripId]);
  const timeZone = tzRes.rows[0]?.local_timezone ?? 'Asia/Riyadh';

  await db.transaction(async (tx) => {
    if (existing.rows[0]) {
      await tx.query(
        `UPDATE day_closes SET status='CLOSED', closed_at=now(), closed_by=$2, snapshot=$3 WHERE id=$1`,
        [id, user.id, JSON.stringify(snapshot ?? null)],
      );
    } else {
      await tx.query(
        `INSERT INTO day_closes (id, trip_id, close_date, status, closed_at, closed_by, snapshot)
         VALUES ($1,$2,$3,'CLOSED',now(),$4,$5)`,
        [id, tripId, closeDate, user.id, JSON.stringify(snapshot ?? null)],
      );
    }
    // Soft-lock the day's financial rows, matching on the Saudi-local travel
    // day the traveller actually experienced.
    const wds = await tx.query<{ id: string; transaction_at: string }>(
      `SELECT id, transaction_at FROM withdrawals WHERE trip_id=$1 AND day_close_id IS NULL`,
      [tripId],
    );
    for (const w of wds.rows) {
      if (riyadhDate(new Date(w.transaction_at).toISOString(), timeZone) === closeDate) {
        await tx.query(`UPDATE withdrawals SET day_close_id=$2, updated_at=now() WHERE id=$1`, [w.id, id]);
      }
    }
    const exps = await tx.query<{ id: string; spent_at: string }>(
      `SELECT id, spent_at FROM cash_expenses WHERE trip_id=$1 AND day_close_id IS NULL`,
      [tripId],
    );
    for (const e of exps.rows) {
      if (riyadhDate(new Date(e.spent_at).toISOString(), timeZone) === closeDate) {
        await tx.query(`UPDATE cash_expenses SET day_close_id=$2 WHERE id=$1`, [e.id, id]);
      }
    }
    await audit(tx, user.id, 'DAY_CLOSED', 'day_closes', id, null, { closeDate, withdrawals: wds.rows.length });
  });
  return { id };
}

export async function recordCorrection(
  db: Db,
  user: AuthedUser,
  body: { targetTable: unknown; targetId: unknown; field: unknown; previousValue?: unknown; newValue?: unknown; reason: unknown },
): Promise<{ id: string }> {
  const id = newId('corr');
  const targetTable = oneOf(body.targetTable, ['withdrawals', 'cash_expenses', 'balance_snapshots', 'cards'] as const, 'targetTable');
  const targetId = requireString(body.targetId, 'targetId', 100);
  const reason = requireString(body.reason, 'reason', 1000);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO corrections (id, target_table, target_id, field, previous_value, new_value, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, targetTable, targetId, requireString(body.field, 'field', 100),
       optionalString(body.previousValue, 'previousValue'), optionalString(body.newValue, 'newValue'),
       reason, user.id],
    );
    await audit(tx, user.id, 'CORRECTION_RECORDED', targetTable, targetId,
      { field: body.field, value: body.previousValue }, { field: body.field, value: body.newValue }, reason);
  });
  return { id };
}

// ---------------------------------------------------------- cash expense ----

export async function addCashExpense(
  db: Db,
  user: AuthedUser,
  body: { ownership: unknown; amountMinor: unknown; category?: unknown; purpose?: unknown; spentAt?: unknown; notes?: unknown },
): Promise<{ id: string }> {
  const ownership = oneOf(body.ownership, ['PERSONAL', 'COMPANY'] as const, 'ownership');
  const amount = parseMinor(body.amountMinor, 'amount');
  if (amount <= 0n) throw badRequest('Expense must be positive', 'المبلغ يجب أن يكون أكبر من صفر');
  const { tripId } = await ensureTripAndWallets(db);
  const spentAt =
    typeof body.spentAt === 'string' && body.spentAt ? new Date(body.spentAt).toISOString() : new Date().toISOString();
  const id = newId('exp');
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO cash_expenses (id, trip_id, ownership, amount_minor, category, purpose, spent_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, tripId, ownership, amount.toString(), optionalString(body.category, 'category', 100),
       optionalString(body.purpose, 'purpose', 500), spentAt, optionalString(body.notes, 'notes'), user.id],
    );
    const wid = await walletId(tx, tripId, ownership);
    await tx.query(
      `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, expense_id, occurred_at, created_by)
       VALUES ($1,$2,'OUT',$3,'EXPENSE',$4,$5,$6)`,
      [newId('cm'), wid, amount.toString(), id, spentAt, user.id],
    );
    await audit(tx, user.id, 'CASH_EXPENSE_ADDED', 'cash_expenses', id, null, {
      ownership, amountMinor: amount.toString(),
    });
  });
  return { id };
}
