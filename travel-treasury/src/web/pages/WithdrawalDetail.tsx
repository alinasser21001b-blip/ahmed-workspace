import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { money, formatSaudiTime, toMinor } from '../lib/format.ts';
import { t, tCause, tCauseRationale, tMsg, tState, tCurrency } from '../i18n.ts';
import { AmountField, Callout, ErrorBox, Figure, Loading, Sheet, StateBadge, type EvidencedWire } from '../components/Common.tsx';

interface Detail {
  id: string; state: string; ownership: string;
  card: { id: string; nickname: string; nativeCurrency: string; last4: string; issuer: string };
  transactionAt: string; transactionLocalTime: string | null; postingDate: string | null;
  atm: { operator: string | null; location: string | null; terminalId: string | null; reference: string | null };
  requestedSarMinor: string | null; dispensedSarMinor: string;
  dcc: { offered: string; selection: string | null };
  surcharge: { minor: string; currency: string; handling: string } | null;
  before: { amountMinor: string; currency: string; source: string; balanceType: string } | null;
  after: { amountMinor: string; currency: string; source: string; balanceType: string } | null;
  pending: { debitMinor: string; feeMinor: string | null; description: string | null; at: string } | null;
  posted: { debitMinor: string; bankFeeMinor: string | null; internationalFeeMinor: string | null; cashWithdrawalFeeMinor: string | null; otherFeeMinor: string | null; statementDescription: string | null; postedAt: string } | null;
  computation: Record<string, EvidencedWire> & { costBasis: string; warnings: { code: string; text: string }[] };
  reconciliation: {
    expectedAfterBalance: EvidencedWire; observedAfterBalance: EvidencedWire; difference: EvidencedWire;
    isReconciled: boolean; potentialCauses: { cause: string; rationale: string; likelihood: string }[];
    suggestedState: string; explanation: string; explanationCode?: string;
  };
  discrepancies: { id: string; difference_minor: string; currency: string; user_classification: string | null }[];
  revisions: { field: string; previous_value: string; new_value: string; changed_at: string; reason: string }[];
  dayCloseId: string | null;
}

const CAUSES = ['PENDING_HOLD', 'SEPARATE_ISSUER_FEE', 'ATM_SURCHARGE', 'OTHER_TRANSACTION', 'DELAYED_BALANCE_REFRESH', 'DCC', 'REVERSAL', 'ENTRY_ERROR', 'UNKNOWN'];

export function WithdrawalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'pending' | 'settle' | 'reverse' | 'classify'>(null);
  const [busy, setBusy] = useState(false);

  const [pendAmt, setPendAmt] = useState('');
  const [pendFee, setPendFee] = useState('');
  const [pendReason, setPendReason] = useState('');
  const [postAmt, setPostAmt] = useState('');
  const [feeBank, setFeeBank] = useState('');
  const [feeIntl, setFeeIntl] = useState('');
  const [feeCash, setFeeCash] = useState('');
  const [feeOther, setFeeOther] = useState('');
  const [stmt, setStmt] = useState('');
  const [revReason, setRevReason] = useState('');
  const [cause, setCause] = useState('SEPARATE_ISSUER_FEE');
  const [causeNote, setCauseNote] = useState('');

  const load = () => {
    setError(null);
    api.get<Detail>(`/v1/withdrawals/${id}`).then(setD).catch((e) => setError((e as Error).message));
  };
  useEffect(load, [id]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!d) return <Loading />;

  const cur = d.card.nativeCurrency;
  const locked = !!d.dayCloseId;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setSheet(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="link" onClick={onBack}>
        ← {t('withdrawals')}
      </button>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div className="stat">
            <span className="label">{t('cashReceived')}</span>
            <span className="value num">{money(d.dispensedSarMinor, 'SAR')}</span>
          </div>
          <StateBadge state={d.state} label={tState(d.state)} />
        </div>
        <div className="spacer" />
        <div className="row">
          <span className="k">{t('card')}</span>
          <span className="v">{d.card.nickname} ••{d.card.last4}</span>
        </div>
        <div className="row">
          <span className="k">{t('ownership')}</span>
          <span className="v">{d.ownership === 'COMPANY' ? t('company') : t('personal')}</span>
        </div>
        <div className="row">
          <span className="k">{t('time')} ({t('saudiTime')})</span>
          <span className="v num">{formatSaudiTime(d.transactionAt)}</span>
        </div>
        {d.postingDate ? (
          <div className="row">
            <span className="k">{t('date')} — {t('posted')}</span>
            <span className="v num">{d.postingDate}</span>
          </div>
        ) : null}
        {locked ? <><div className="spacer" /><Callout tone="info">{t('dayClosed')}</Callout></> : null}
      </div>

      {d.computation.warnings.length > 0 ? (
        <Callout tone="warn">
          <div className="strong">{t('warnings')}</div>
          <ul>
            {d.computation.warnings.map((w, i) => (
              <li key={i}>{tMsg(w.code, w.text)}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="card">
        <h2>{t('calculations')}</h2>
        <Figure label={t('observedDelta')} value={d.computation.observedBalanceDelta} />
        <Figure label={t('pendingDebit')} value={d.computation.pendingDebitTotal} />
        <Figure label={t('postedDebit')} value={d.computation.postedDebitTotal} />
        <Figure label={t('issuerFees')} value={d.computation.issuerFees} />
        <Figure label={t('atmOperatorFee')} value={d.computation.atmOperatorFee} />
        <Figure label={t('allInCost')} value={d.computation.nativeAllInCost} big />
        <Figure label={t('effectiveRate')} value={d.computation.effectiveNativePerSar} big />
        <Figure label={t('referenceIqdCost')} value={d.computation.referenceIqdCost} />
        <Figure label={t('economicIqdCost')} value={d.computation.economicIqdCost} />
        <Figure label={t('verifiedIqdRate')} value={d.computation.verifiedIqdPerSar} />
      </div>

      <div className="card">
        <h2>{t('reconcile')}</h2>
        <Figure label={t('expectedBalance')} value={d.reconciliation.expectedAfterBalance} />
        <Figure label={t('confirmedBalance')} value={d.reconciliation.observedAfterBalance} />
        <Figure label={t('difference')} value={d.reconciliation.difference} big />
        <div className="spacer" />
        <Callout tone={d.reconciliation.isReconciled ? 'ok' : 'warn'}>
          {tMsg(d.reconciliation.explanationCode, d.reconciliation.explanation)}
        </Callout>
        {d.reconciliation.potentialCauses.length > 0 ? (
          <>
            <h3>{t('possibleCauses')}</h3>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {d.reconciliation.potentialCauses.map((c, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <span className="strong">{tCause(c.cause)}</span> — <span className="muted">{tCauseRationale(c.cause, c.rationale)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!locked ? (
          <>
            <div className="spacer" />
            <button type="button" className="secondary" onClick={() => void act(() => api.post(`/v1/withdrawals/${id}/reconcile`))}>
              {t('reconcileNow')}
            </button>
          </>
        ) : null}
      </div>

      {d.discrepancies.filter((x) => !x.user_classification).length > 0 ? (
        <div className="card">
          <h2>{t('classifyDiscrepancy')}</h2>
          {d.discrepancies.filter((x) => !x.user_classification).map((x) => (
            <div className="row" key={x.id}>
              <span className="k">{t('unexplainedDifference')}</span>
              <span className="v num">{money(x.difference_minor, x.currency)}</span>
            </div>
          ))}
          <div className="spacer" />
          <button type="button" className="secondary" onClick={() => setSheet('classify')}>
            {t('classifyDiscrepancy')}
          </button>
        </div>
      ) : null}

      {d.revisions.length > 0 ? (
        <div className="card">
          <h2>{t('revisions')}</h2>
          {d.revisions.map((r, i) => (
            <div className="row" key={i}>
              <span className="k">
                {r.field}
                <div className="tiny">{r.reason}</div>
              </span>
              <span className="v num">
                {r.previous_value} → {r.new_value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!locked ? (
        <div className="card">
          <h2>{t('actions')}</h2>
          <button type="button" className="secondary" onClick={() => setSheet('pending')}>
            {t('recordPending')}
          </button>
          <div className="spacer" />
          <button type="button" className="secondary" onClick={() => setSheet('settle')}>
            {t('recordSettlement')}
          </button>
          <div className="spacer" />
          <button type="button" className="danger-btn" onClick={() => setSheet('reverse')}>
            {t('reverse')}
          </button>
          <div className="tiny" style={{ marginTop: 8 }}>{t('reversalKeepsOriginal')}</div>
        </div>
      ) : null}

      {sheet === 'pending' ? (
        <Sheet title={t('recordPending')} onClose={() => setSheet(null)}>
          <AmountField label={t('pendingAmount')} value={pendAmt} onChange={setPendAmt} currency={cur} autoFocus />
          <AmountField label={`${t('pendingFee')} (${t('optional')})`} value={pendFee} onChange={setPendFee} currency={cur} />
          {d.pending ? (
            <div className="field">
              <label htmlFor="pr">{t('reason')}</label>
              <input id="pr" value={pendReason} onChange={(e) => setPendReason(e.target.value)} />
              <div className="hint">{t('revisions')}</div>
            </div>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={busy || !toMinor(pendAmt, cur)}
            onClick={() =>
              void act(() =>
                api.post(`/v1/withdrawals/${id}/pending`, {
                  pendingDebitMinor: toMinor(pendAmt, cur),
                  pendingFeeMinor: pendFee.trim() ? toMinor(pendFee, cur) : null,
                  reason: pendReason.trim() || 'Pending amount revised',
                }),
              )
            }
          >
            {t('save')}
          </button>
        </Sheet>
      ) : null}

      {sheet === 'settle' ? (
        <Sheet title={t('recordSettlement')} onClose={() => setSheet(null)}>
          <AmountField label={t('postedAmount')} value={postAmt} onChange={setPostAmt} currency={cur} autoFocus />
          <AmountField label={`${t('bankFee')} (${t('optional')})`} value={feeBank} onChange={setFeeBank} currency={cur} />
          <AmountField label={`${t('intlFee')} (${t('optional')})`} value={feeIntl} onChange={setFeeIntl} currency={cur} />
          <AmountField label={`${t('cashWithdrawalFee')} (${t('optional')})`} value={feeCash} onChange={setFeeCash} currency={cur} />
          <AmountField label={`${t('otherFee')} (${t('optional')})`} value={feeOther} onChange={setFeeOther} currency={cur} />
          <div className="field">
            <label htmlFor="st">{t('statementDescription')}</label>
            <input id="st" value={stmt} onChange={(e) => setStmt(e.target.value)} />
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || !toMinor(postAmt, cur)}
            onClick={() =>
              void act(() =>
                api.post(`/v1/withdrawals/${id}/settle`, {
                  postedDebitMinor: toMinor(postAmt, cur),
                  postedBankFeeMinor: feeBank.trim() ? toMinor(feeBank, cur) : null,
                  postedInternationalFeeMinor: feeIntl.trim() ? toMinor(feeIntl, cur) : null,
                  postedCashWithdrawalFeeMinor: feeCash.trim() ? toMinor(feeCash, cur) : null,
                  postedOtherFeeMinor: feeOther.trim() ? toMinor(feeOther, cur) : null,
                  statementDescription: stmt.trim() || null,
                }),
              )
            }
          >
            {t('save')}
          </button>
        </Sheet>
      ) : null}

      {sheet === 'reverse' ? (
        <Sheet title={t('reverse')} onClose={() => setSheet(null)}>
          <Callout tone="info">{t('reversalKeepsOriginal')}</Callout>
          <div className="spacer" />
          <div className="field">
            <label htmlFor="rr">{t('reverseReason')}</label>
            <input id="rr" value={revReason} onChange={(e) => setRevReason(e.target.value)} autoFocus />
          </div>
          <button
            type="button"
            className="danger-btn"
            disabled={busy || revReason.trim().length === 0}
            onClick={() => void act(() => api.post(`/v1/withdrawals/${id}/reverse`, { reason: revReason.trim() }))}
          >
            {t('confirm')}
          </button>
        </Sheet>
      ) : null}

      {sheet === 'classify' ? (
        <Sheet title={t('classifyDiscrepancy')} onClose={() => setSheet(null)}>
          <div className="field">
            <label htmlFor="cz">{t('classification')}</label>
            <select id="cz" value={cause} onChange={(e) => setCause(e.target.value)}>
              {CAUSES.map((c) => (
                <option key={c} value={c}>
                  {tCause(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cn">{t('notes')}</label>
            <input id="cn" value={causeNote} onChange={(e) => setCauseNote(e.target.value)} />
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              const open = d.discrepancies.find((x) => !x.user_classification);
              if (!open) return;
              void act(() =>
                api.post(`/v1/discrepancies/${open.id}/classify`, {
                  classification: cause,
                  resolutionNote: causeNote.trim() || null,
                }),
              );
            }}
          >
            {t('save')}
          </button>
        </Sheet>
      ) : null}

      <div className="card">
        <h2>{t('evidence')}</h2>
        <div className="row">
          <span className="k">{t('balanceBefore')}</span>
          <span className="v num">{d.before ? money(d.before.amountMinor, d.before.currency) : '—'}</span>
        </div>
        <div className="row">
          <span className="k">{t('balanceAfter')}</span>
          <span className="v num">{d.after ? money(d.after.amountMinor, d.after.currency) : '—'}</span>
        </div>
        <div className="row">
          <span className="k">{t('dccQuestion')}</span>
          <span className="v">
            {d.dcc.offered === 'YES'
              ? d.dcc.selection === 'LOCAL_CURRENCY'
                ? t('dccChoseSar')
                : d.dcc.selection === 'BILLING_CURRENCY'
                  ? t('dccChoseCard')
                  : t('unknown')
              : d.dcc.offered === 'NO'
                ? t('no')
                : t('unknown')}
          </span>
        </div>
        {d.surcharge ? (
          <div className="row">
            <span className="k">{t('atmFee')}</span>
            <span className="v num">{money(d.surcharge.minor, d.surcharge.currency)}</span>
          </div>
        ) : null}
        {d.atm.operator ? (
          <div className="row">
            <span className="k">{t('atmOperator')}</span>
            <span className="v">{d.atm.operator}</span>
          </div>
        ) : null}
        <div className="tiny" style={{ marginTop: 8 }}>{tCurrency(cur)}</div>
      </div>
    </>
  );
}
