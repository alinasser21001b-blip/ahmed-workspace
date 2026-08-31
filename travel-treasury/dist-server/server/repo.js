import { notFound } from "./util.js";
/** Row mapping. All money comes out of the driver as text and becomes bigint here. */
export function moneyFrom(minor, currency) {
    if (minor === null || minor === undefined || !currency)
        return null;
    return { minor: BigInt(minor), currency: currency };
}
export function cardRefFrom(row) {
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
export async function getCardRow(db, cardId) {
    const res = await db.query(`SELECT * FROM cards WHERE id = $1`, [cardId]);
    const row = res.rows[0];
    if (!row)
        throw notFound(`Card ${cardId} not found`, 'البطاقة غير موجودة');
    return row;
}
export function observationFrom(row) {
    if (!row)
        return null;
    return {
        amount: { minor: BigInt(row.amount_minor), currency: row.currency },
        capturedAt: new Date(row.captured_at).toISOString(),
        source: row.source,
        balanceType: row.balance_type,
    };
}
export async function getWithdrawalRow(db, id) {
    const res = await db.query(`SELECT * FROM withdrawals WHERE id = $1`, [id]);
    const row = res.rows[0];
    if (!row)
        throw notFound(`Withdrawal ${id} not found`, 'عملية السحب غير موجودة');
    return row;
}
export async function withdrawalInputFrom(db, row) {
    const cardRow = await getCardRow(db, row.card_id);
    const card = cardRefFrom(cardRow);
    const native = card.nativeCurrency;
    const snapIds = [row.before_snapshot_id, row.after_snapshot_id].filter((x) => !!x);
    const snaps = snapIds.length
        ? (await db.query(`SELECT * FROM balance_snapshots WHERE id = ANY($1)`, [snapIds])).rows
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
                debit: { minor: BigInt(row.pending_debit_minor), currency: (row.pending_debit_currency ?? native) },
                fee: moneyFrom(row.pending_fee_minor, row.pending_debit_currency ?? native),
                description: row.pending_description,
                at: row.pending_at ? new Date(row.pending_at).toISOString() : row.transaction_at,
            }
            : null,
        posted: row.posted_debit_minor
            ? {
                debit: { minor: BigInt(row.posted_debit_minor), currency: (row.posted_debit_currency ?? native) },
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
export function feeRuleFrom(row) {
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
export async function fundingEventsFor(db, cardId) {
    const res = await db.query(`SELECT credited_minor, credited_currency, iqd_paid_minor, funding_fee_minor, funding_fee_currency, occurred_at
        FROM funding_events WHERE card_id = $1 ORDER BY occurred_at`, [cardId]);
    return res.rows.map((r) => ({
        credited: { minor: BigInt(r.credited_minor), currency: r.credited_currency },
        iqdPaid: moneyFrom(r.iqd_paid_minor, 'IQD'),
        fundingFee: moneyFrom(r.funding_fee_minor, r.funding_fee_currency ?? 'IQD'),
        occurredAt: new Date(r.occurred_at).toISOString(),
    }));
}
export async function latestReferenceRate(db, base, quote) {
    const res = await db.query(`SELECT rate::text AS rate, rate_type, effective_date::text AS effective_date, source_id
       FROM reference_rates WHERE base_currency = $1 AND quote_currency = $2
      ORDER BY effective_date DESC, fetched_at DESC LIMIT 1`, [base, quote]);
    const row = res.rows[0];
    if (!row)
        return null;
    return { rate: row.rate, rateType: row.rate_type, effectiveDate: String(row.effective_date).slice(0, 10), sourceId: row.source_id };
}
