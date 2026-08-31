import { riyadhDate } from "./util.js";
/**
 * Exports preserve the separation the product is built on: native amounts,
 * SAR, and IQD stay in their own labelled columns; estimated and verified
 * figures are never flattened together; every row carries its state and its
 * verification status.
 */
function esc(v) {
    if (v === null || v === undefined)
        return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers, rows) {
    const lines = [headers.map(esc).join(',')];
    for (const row of rows)
        lines.push(row.map(esc).join(','));
    // BOM so Excel opens UTF-8 (and Arabic text) correctly.
    return '﻿' + lines.join('\r\n') + '\r\n';
}
const WITHDRAWAL_HEADERS = [
    'id', 'state', 'pricing_status', 'card_nickname', 'issuer', 'product', 'last4', 'ownership',
    'native_currency', 'transaction_at_utc', 'transaction_local_time', 'posting_date',
    'atm_operator', 'atm_terminal_id',
    'requested_sar', 'dispensed_sar', 'atm_surcharge', 'atm_surcharge_currency', 'surcharge_handling',
    'dcc_offered', 'dcc_selection',
    'before_balance_native', 'after_balance_native', 'observed_delta_native',
    'pending_debit_native', 'pending_fee_native',
    'posted_debit_native', 'posted_bank_fee_native', 'posted_international_fee_native',
    'posted_cash_withdrawal_fee_native', 'posted_other_fee_native',
    'all_in_cost_native', 'all_in_cost_basis',
    'effective_rate_native_per_sar', 'effective_rate_status',
    'statement_description', 'notes',
];
function scaleSar(minor) {
    if (minor === null || minor === undefined)
        return '';
    const b = BigInt(minor);
    const neg = b < 0n;
    const abs = (neg ? -b : b).toString().padStart(3, '0');
    return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}
function scaleNative(minor, currency) {
    if (minor === null || minor === undefined)
        return '';
    if (currency === 'IQD')
        return minor;
    return scaleSar(minor);
}
export async function withdrawalsCsv(db, f) {
    const res = await db.query(`SELECT w.*, c.nickname, c.issuer, c.product, c.last4, c.native_currency,
            b.amount_minor::text AS before_minor, a.amount_minor::text AS after_minor
       FROM withdrawals w
       JOIN cards c ON c.id = w.card_id
       LEFT JOIN balance_snapshots b ON b.id = w.before_snapshot_id
       LEFT JOIN balance_snapshots a ON a.id = w.after_snapshot_id
      WHERE w.trip_id = $1 ${f.ownership ? `AND w.ownership = '${f.ownership}'` : ''}
      ORDER BY w.transaction_at`, [f.tripId]);
    const rows = [];
    for (const r of res.rows) {
        const localDay = riyadhDate(new Date(r.transaction_at).toISOString());
        if (f.date && localDay !== f.date)
            continue;
        if (f.from && localDay < f.from)
            continue;
        if (f.to && localDay > f.to)
            continue;
        const cur = r.native_currency;
        let allIn = null;
        let basis = '';
        if (r.posted_debit_minor) {
            allIn = BigInt(r.posted_debit_minor);
            for (const k of ['posted_bank_fee_minor', 'posted_international_fee_minor', 'posted_cash_withdrawal_fee_minor', 'posted_other_fee_minor']) {
                if (r[k])
                    allIn += BigInt(r[k]);
            }
            basis = 'POSTED';
        }
        else if (r.before_minor && r.after_minor) {
            allIn = BigInt(r.before_minor) - BigInt(r.after_minor);
            basis = 'OBSERVED';
        }
        else if (r.pending_debit_minor) {
            allIn = BigInt(r.pending_debit_minor) + BigInt(r.pending_fee_minor ?? '0');
            basis = 'PENDING';
        }
        let rate = '';
        let rateStatus = 'NOT_DETERMINABLE';
        const dispensed = BigInt(r.dispensed_sar_minor);
        if (allIn !== null && dispensed > 0n) {
            // native major per SAR, to 4 places, exact integer arithmetic.
            const factor = cur === 'IQD' ? 1n : 100n;
            const scaled = (allIn * 100n * 10000n + (dispensed * factor) / 2n) / (dispensed * factor);
            const s = scaled.toString().padStart(5, '0');
            rate = `${s.slice(0, -4)}.${s.slice(-4)}`;
            rateStatus = basis;
        }
        else if (dispensed === 0n) {
            rateStatus = 'NO_CASH_DISPENSED';
        }
        const pricingStatus = r.state === 'RECONCILED' ? 'RECONCILED'
            : r.posted_debit_minor ? 'POSTED'
                : r.pending_debit_minor ? 'PENDING'
                    : (r.before_minor && r.after_minor) ? 'OBSERVED'
                        : 'ESTIMATED';
        rows.push([
            r.id, r.state, pricingStatus, r.nickname, r.issuer, r.product, r.last4, r.ownership,
            cur, r.transaction_at, r.transaction_local_time, r.posting_date ? String(r.posting_date).slice(0, 10) : '',
            r.atm_operator, r.atm_terminal_id,
            scaleSar(r.requested_sar_minor), scaleSar(r.dispensed_sar_minor),
            r.atm_surcharge_minor ? scaleNative(r.atm_surcharge_minor, r.atm_surcharge_currency ?? cur) : '',
            r.atm_surcharge_currency ?? '', r.surcharge_handling,
            r.dcc_offered, r.dcc_selection ?? '',
            scaleNative(r.before_minor, cur), scaleNative(r.after_minor, cur),
            r.before_minor && r.after_minor ? scaleNative((BigInt(r.before_minor) - BigInt(r.after_minor)).toString(), cur) : '',
            scaleNative(r.pending_debit_minor, cur), scaleNative(r.pending_fee_minor, cur),
            scaleNative(r.posted_debit_minor, cur), scaleNative(r.posted_bank_fee_minor, cur),
            scaleNative(r.posted_international_fee_minor, cur), scaleNative(r.posted_cash_withdrawal_fee_minor, cur),
            scaleNative(r.posted_other_fee_minor, cur),
            allIn !== null ? scaleNative(allIn.toString(), cur) : '', basis,
            rate, rateStatus,
            r.statement_description, r.notes,
        ]);
    }
    return toCsv(WITHDRAWAL_HEADERS, rows);
}
export async function reconciliationCsv(db, tripId) {
    const res = await db.query(`SELECT d.id, d.withdrawal_id, w.state, c.nickname, c.native_currency,
            d.expected_minor::text AS expected_minor, d.observed_minor::text AS observed_minor,
            d.difference_minor::text AS difference_minor, d.currency, d.confidence,
            d.user_classification, d.resolution_note, d.created_at::text AS created_at
       FROM discrepancies d
       JOIN withdrawals w ON w.id = d.withdrawal_id
       JOIN cards c ON c.id = w.card_id
      WHERE w.trip_id = $1 ORDER BY d.created_at`, [tripId]);
    return toCsv(['discrepancy_id', 'withdrawal_id', 'withdrawal_state', 'card', 'currency', 'expected_after_balance', 'observed_after_balance', 'difference', 'cost_basis', 'user_classification', 'resolution_note', 'created_at'], res.rows.map((r) => [
        r.id, r.withdrawal_id, r.state, r.nickname, r.currency,
        scaleNative(r.expected_minor, r.currency),
        scaleNative(r.observed_minor, r.currency),
        scaleNative(r.difference_minor, r.currency),
        r.confidence, r.user_classification ?? 'UNCLASSIFIED', r.resolution_note, r.created_at,
    ]));
}
export async function treasuryCsv(db, tripId) {
    const res = await db.query(`SELECT m.id, w.ownership, m.direction, m.amount_minor::text AS amount_minor, m.kind,
            m.withdrawal_id, m.expense_id, m.occurred_at::text AS occurred_at, m.notes
       FROM cash_movements m JOIN cash_wallets w ON w.id = m.wallet_id
      WHERE w.trip_id = $1 ORDER BY m.occurred_at`, [tripId]);
    return toCsv(['movement_id', 'ownership', 'direction', 'amount_sar', 'kind', 'withdrawal_id', 'expense_id', 'occurred_at_utc', 'notes'], res.rows.map((r) => [r.id, r.ownership, r.direction, scaleSar(r.amount_minor), r.kind, r.withdrawal_id, r.expense_id, r.occurred_at, r.notes]));
}
export async function auditCsv(db) {
    const res = await db.query(`SELECT id, actor_user_id, action, entity_table, entity_id,
            previous_value::text AS previous_value, new_value::text AS new_value, reason, occurred_at::text AS occurred_at
       FROM audit_events ORDER BY occurred_at`);
    return toCsv(['audit_id', 'actor', 'action', 'entity_table', 'entity_id', 'previous_value', 'new_value', 'reason', 'occurred_at_utc'], res.rows.map((r) => [r.id, r.actor_user_id, r.action, r.entity_table, r.entity_id, r.previous_value, r.new_value, r.reason, r.occurred_at]));
}
