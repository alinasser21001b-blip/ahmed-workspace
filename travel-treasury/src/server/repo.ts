import type { CurrencyCode } from '../core/currency.ts';
import type { Money } from '../core/money.ts';
import type { FeeRule } from '../core/fees.ts';
import type { CardRef, WithdrawalInput, BalanceObservation, FundingEvent } from '../core/withdrawal.ts';
import type { Db } from './db/db.ts';
import { notFound } from './util.ts';

/** Row mapping. All money comes out of the driver as text and becomes bigint here. */
export function moneyFrom(minor: string | number | bigint | null, currency: string | null): Money | null {
  if (minor === null || minor === undefined || !currency) return null;
  return { minor: BigInt(minor), currency: currency as CurrencyCode };
}

export interface CardRow {
  id: string; trip_id: string | null; nickname: string; issuer: string; product: string;
  network: CardRef['network']; card_type: CardRef['cardType']; last4: string;
  ownership: CardRef['ownership']; native_currency: CurrencyCode;
  opening_available_minor: string | null; opening_ledger_minor: string | null;
  daily_atm_limit_minor: string | null; daily_atm_limit_currency: string | null;
  per_transaction_limit_minor: string | null; per_transaction_limit_currency: string | null;
  intl_monthly_limit_minor: string | null; intl_monthly_limit_currency: string | null;
  trip_allocation_minor: string | null;
  international_status: CardRef['internationalStatus'];
  international_status_evidence: string | null;
  is_active: boolean; notes: string | null;
}

export function cardRefFrom(row: CardRow): CardRef {
  return {
    id: row.id,
    nickname: row.nickname,
    issuer: row.issuer,
    product: row.product,
    network: row.network,
    cardType: row.card_type,
    last4: row.last4,
    ownership: row.ownership,
    nativeCurrency: row.native_currency,
    internationalStatus: row.international_status,
  };
}

export async function getCardRow(db: Db, cardId: string): Promise<CardRow> {
  const res = await db.query<CardRow>(`SELECT * FROM cards WHERE id = $1`, [cardId]);
  const row = res.rows[0];
  if (!row) throw notFound(`Card ${cardId} not found`, 'البطاقة غير موجودة');
  return row;
}

export interface SnapshotRow {
  id: string; card_id: string; amount_minor: string; currency: CurrencyCode;
  captured_at: string; source: BalanceObservation['source']; balance_type: BalanceObservation['balanceType'];
}

export function observationFrom(row: SnapshotRow | undefined | null): BalanceObservation | null {
  if (!row) return null;
  return {
    amount: { minor: BigInt(row.amount_minor), currency: row.currency },
    capturedAt: new Date(row.captured_at).toISOString(),
    source: row.source,
    balanceType: row.balance_type,
  };
}

export interface WithdrawalRow {
  id: string; idempotency_key: string; trip_id: string; card_id: string;
  ownership: 'PERSONAL' | 'COMPANY'; state: WithdrawalInput['state'];
  transaction_at: string; transaction_local_time: string | null; posting_date: string | null;
  atm_operator: string | null; atm_location: string | null; atm_terminal_id: string | null;
  transaction_reference: string | null;
  requested_sar_minor: string | null; dispensed_sar_minor: string;
  atm_surcharge_minor: string | null; atm_surcharge_currency: string | null;
  surcharge_handling: 'INCLUDED_IN_DEBIT' | 'POSTED_SEPARATELY' | 'UNKNOWN';
  dcc_offered: 'YES' | 'NO' | 'UNKNOWN';
  dcc_selection: 'LOCAL_CURRENCY' | 'BILLING_CURRENCY' | 'UNKNOWN' | null;
  dcc_offered_rate: string | null; dcc_markup_percent: string | null;
  dcc_converted_minor: string | null; dcc_converted_currency: string | null;
  before_snapshot_id: string | null; after_snapshot_id: string | null;
  pending_debit_minor: string | null; pending_debit_currency: string | null;
  pending_fee_minor: string | null; pending_description: string | null; pending_at: string | null;
  posted_debit_minor: string | null; posted_debit_currency: string | null;
  posted_bank_fee_minor: string | null; posted_international_fee_minor: string | null;
  posted_cash_withdrawal_fee_minor: string | null; posted_other_fee_minor: string | null;
  statement_description: string | null; posted_at: string | null;
  receipt_evidence_id: string | null; notes: string | null; day_close_id: string | null;
  voided_by_id: string | null; reversal_of_id: string | null; duplicate_warning_ack: boolean;
  created_by: string; created_at: string; updated_at: string;
}

export async function getWithdrawalRow(db: Db, id: string): Promise<WithdrawalRow> {
  const res = await db.query<WithdrawalRow>(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row) throw notFound(`Withdrawal ${id} not found`, 'عملية السحب غير موجودة');
  return row;
}

export async function withdrawalInputFrom(db: Db, row: WithdrawalRow): Promise<WithdrawalInput> {
  const cardRow = await getCardRow(db, row.card_id);
  const card = cardRefFrom(cardRow);
  const native = card.nativeCurrency;

  const snapIds = [row.before_snapshot_id, row.after_snapshot_id].filter((x): x is string => !!x);
  const snaps = snapIds.length
    ? (await db.query<SnapshotRow>(
        `SELECT * FROM balance_snapshots WHERE id = ANY($1)`,
        [snapIds],
      )).rows
    : [];
  const before = observationFrom(snaps.find((s) => s.id === row.before_snapshot_id));
  const after = observationFrom(snaps.find((s) => s.id === row.after_snapshot_id));

  return {
    id: row.id,
    card,
    state: row.state,
    transactionAt: new Date(row.transaction_at).toISOString(),
    postingDate: row.posting_date,
    requestedSar: moneyFrom(row.requested_sar_minor, 'SAR'),
    dispensedSar: { minor: BigInt(row.dispensed_sar_minor), currency: 'SAR' },
    atmSurcharge: moneyFrom(row.atm_surcharge_minor, row.atm_surcharge_currency),
    surchargeHandling: row.surcharge_handling,
    dcc: {
      offered: row.dcc_offered,
      selection: row.dcc_selection,
      convertedAmount: moneyFrom(row.dcc_converted_minor, row.dcc_converted_currency),
    },
    before,
    after,
    pending: row.pending_debit_minor
      ? {
          debit: { minor: BigInt(row.pending_debit_minor), currency: (row.pending_debit_currency ?? native) as CurrencyCode },
          fee: moneyFrom(row.pending_fee_minor, row.pending_debit_currency ?? native),
          description: row.pending_description,
          at: row.pending_at ? new Date(row.pending_at).toISOString() : row.transaction_at,
        }
      : null,
    posted: row.posted_debit_minor
      ? {
          debit: { minor: BigInt(row.posted_debit_minor), currency: (row.posted_debit_currency ?? native) as CurrencyCode },
          bankFee: moneyFrom(row.posted_bank_fee_minor, row.posted_debit_currency ?? native),
          internationalFee: moneyFrom(row.posted_international_fee_minor, row.posted_debit_currency ?? native),
          cashWithdrawalFee: moneyFrom(row.posted_cash_withdrawal_fee_minor, row.posted_debit_currency ?? native),
          otherFee: moneyFrom(row.posted_other_fee_minor, row.posted_debit_currency ?? native),
          postedAt: new Date(row.posted_at ?? row.transaction_at).toISOString(),
          statementDescription: row.statement_description,
        }
      : null,
  };
}

export interface FeeRuleRow {
  id: string; card_id: string | null; issuer: string | null; product: string | null;
  rule_type: FeeRule['ruleType']; transaction_type: FeeRule['transactionType'];
  region: FeeRule['region']; amount_minor: string | null; amount_currency: string | null;
  percent: string | null; min_minor: string | null; max_minor: string | null;
  amount_is_range: boolean; currency: CurrencyCode; effective_from: string; effective_to: string | null;
  source_id: string; confidence: FeeRule['confidence']; verified_at: string | null;
  is_ambiguous: boolean; ambiguity_note: string | null; notes: string | null;
}

export function feeRuleFrom(row: FeeRuleRow): FeeRule {
  return {
    id: row.id,
    cardId: row.card_id,
    issuer: row.issuer,
    product: row.product,
    ruleType: row.rule_type,
    transactionType: row.transaction_type,
    region: row.region,
    amount: moneyFrom(row.amount_minor, row.amount_currency ?? row.currency),
    percent: row.percent,
    min: moneyFrom(row.min_minor, row.currency),
    max: moneyFrom(row.max_minor, row.currency),
    amountIsRange: row.amount_is_range,
    currency: row.currency,
    effectiveFrom: typeof row.effective_from === 'string' ? row.effective_from.slice(0, 10) : String(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    sourceId: row.source_id,
    confidence: row.confidence,
    verifiedAt: row.verified_at,
    isAmbiguous: row.is_ambiguous,
    ambiguityNote: row.ambiguity_note,
    notes: row.notes ?? undefined,
  };
}

export async function fundingEventsFor(db: Db, cardId: string): Promise<FundingEvent[]> {
  const res = await db.query<{
    credited_minor: string; credited_currency: CurrencyCode;
    iqd_paid_minor: string | null; funding_fee_minor: string | null; funding_fee_currency: string | null;
    occurred_at: string;
  }>(`SELECT credited_minor, credited_currency, iqd_paid_minor, funding_fee_minor, funding_fee_currency, occurred_at
        FROM funding_events WHERE card_id = $1 ORDER BY occurred_at`, [cardId]);
  return res.rows.map((r) => ({
    credited: { minor: BigInt(r.credited_minor), currency: r.credited_currency },
    iqdPaid: moneyFrom(r.iqd_paid_minor, 'IQD'),
    fundingFee: moneyFrom(r.funding_fee_minor, r.funding_fee_currency ?? 'IQD'),
    occurredAt: new Date(r.occurred_at).toISOString(),
  }));
}

export async function latestReferenceRate(
  db: Db,
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<{ rate: string; rateType: string; effectiveDate: string; sourceId: string | null } | null> {
  const res = await db.query<{ rate: string; rate_type: string; effective_date: string; source_id: string | null }>(
    `SELECT rate::text AS rate, rate_type, effective_date::text AS effective_date, source_id
       FROM reference_rates WHERE base_currency = $1 AND quote_currency = $2
      ORDER BY effective_date DESC, fetched_at DESC LIMIT 1`,
    [base, quote],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { rate: row.rate, rateType: row.rate_type, effectiveDate: String(row.effective_date).slice(0, 10), sourceId: row.source_id };
}
