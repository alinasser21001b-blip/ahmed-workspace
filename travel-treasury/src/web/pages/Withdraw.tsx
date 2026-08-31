import { useEffect, useMemo, useState } from 'react';
import { api, enqueue, isOnline, newIdempotencyKey, type ApiError } from '../lib/api.ts';
import { money, toMinor } from '../lib/format.ts';
import { t, tCurrency } from '../i18n.ts';
import { AmountField, Callout, Choice, Loading } from '../components/Common.tsx';

interface CardSummary {
  id: string; nickname: string; issuer: string; last4: string;
  ownership: 'PERSONAL' | 'COMPANY'; native_currency: string; network: string;
  international_status: string;
}

type Dcc = 'LOCAL' | 'BILLING' | 'NOT_OFFERED' | null;

/**
 * The screen used while standing at the machine.
 *
 * Quick mode asks for the five things that actually determine the answer and
 * nothing else. Everything optional lives behind "full mode", because a form
 * that is slow to fill in at an ATM is a form that gets filled in wrongly, or
 * not at all.
 */
export function Withdraw({ onSaved }: { onSaved: (id: string | null) => void }) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [cardId, setCardId] = useState<string>('');
  const [cash, setCash] = useState('');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [dcc, setDcc] = useState<Dcc>(null);
  const [atmFee, setAtmFee] = useState('');
  const [full, setFull] = useState(false);
  const [requested, setRequested] = useState('');
  const [operator, setOperator] = useState('');
  const [location, setLocation] = useState('');
  const [terminal, setTerminal] = useState('');
  const [notes, setNotes] = useState('');
  const [balanceSource, setBalanceSource] = useState<'BANK_APP' | 'SMS' | 'ATM_RECEIPT' | 'STATEMENT' | 'MANUAL'>('BANK_APP');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [duplicate, setDuplicate] = useState<{ reasons: string[] } | null>(null);
  const [idemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    api
      .get<{ cards: CardSummary[] }>('/v1/cards')
      .then((r) => {
        const active = r.cards;
        setCards(active);
        if (active.length === 1) setCardId(active[0]!.id);
      })
      .catch(() => setCards([]));
  }, []);

  const card = useMemo(() => cards?.find((c) => c.id === cardId) ?? null, [cards, cardId]);
  const nativeCur = card?.native_currency ?? 'IQD';

  const cashMinor = toMinor(cash, 'SAR');
  const canSave = !!card && cashMinor !== null && !busy;

  function buildBody(ack: boolean) {
    const beforeMinor = before.trim() ? toMinor(before, nativeCur) : null;
    const afterMinor = after.trim() ? toMinor(after, nativeCur) : null;
    const feeMinor = atmFee.trim() ? toMinor(atmFee, 'SAR') : null;
    const requestedMinor = requested.trim() ? toMinor(requested, 'SAR') : null;
    return {
      idempotencyKey: idemKey,
      cardId,
      dispensedSarMinor: cashMinor,
      requestedSarMinor: requestedMinor,
      transactionAt: new Date().toISOString(),
      dccOffered: dcc === 'NOT_OFFERED' ? 'NO' : dcc ? 'YES' : 'UNKNOWN',
      dccSelection: dcc === 'LOCAL' ? 'LOCAL_CURRENCY' : dcc === 'BILLING' ? 'BILLING_CURRENCY' : null,
      atmSurchargeMinor: feeMinor,
      atmSurchargeCurrency: feeMinor ? 'SAR' : null,
      atmOperator: operator.trim() || null,
      atmLocation: location.trim() || null,
      atmTerminalId: terminal.trim() || null,
      notes: notes.trim() || null,
      before: beforeMinor ? { amountMinor: beforeMinor, source: balanceSource, balanceType: 'AVAILABLE' } : null,
      after: afterMinor ? { amountMinor: afterMinor, source: balanceSource, balanceType: 'AVAILABLE' } : null,
      duplicateWarningAck: ack,
    };
  }

  async function save(ack = false) {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    const body = buildBody(ack);

    if (!isOnline()) {
      enqueue({
        key: idemKey,
        path: '/v1/withdrawals',
        body: body as unknown as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        label: `${money(cashMinor!, 'SAR')} — ${card!.nickname}`,
      });
      setBusy(false);
      setMessage({ tone: 'warn', text: t('savedOffline') });
      onSaved(null);
      return;
    }

    try {
      const r = await api.post<{ id: string; created: boolean }>('/v1/withdrawals', body);
      setBusy(false);
      onSaved(r.id);
    } catch (e) {
      const err = e as ApiError;
      setBusy(false);
      if (err.status === 409 && (err.body as { duplicateWarning?: { findings: { reasons: string[] }[] } })?.duplicateWarning) {
        const findings = (err.body as { duplicateWarning: { findings: { reasons: string[] }[] } }).duplicateWarning.findings;
        setDuplicate({ reasons: findings.flatMap((f) => f.reasons) });
        return;
      }
      if (err.status === 0 || err.message === 'Failed to fetch') {
        enqueue({
          key: idemKey,
          path: '/v1/withdrawals',
          body: body as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          label: `${money(cashMinor!, 'SAR')} — ${card!.nickname}`,
        });
        setMessage({ tone: 'warn', text: t('savedOffline') });
        onSaved(null);
        return;
      }
      setMessage({ tone: 'danger', text: err.errorAr ?? err.message });
    }
  }

  if (!cards) return <Loading />;
  if (cards.length === 0) {
    return (
      <div className="card">
        <Callout tone="info">{t('noData')} — {t('addCard')}</Callout>
      </div>
    );
  }

  return (
    <>
      {message ? <Callout tone={message.tone}>{message.text}</Callout> : null}

      {duplicate ? (
        <div className="card">
          <Callout tone="warn">
            <div className="strong">{t('duplicateWarning')}</div>
            <ul>
              {duplicate.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Callout>
          <div className="spacer" />
          <button type="button" className="primary" onClick={() => { setDuplicate(null); void save(true); }}>
            {t('duplicateConfirm')}
          </button>
          <div className="spacer" />
          <button type="button" className="link" onClick={() => setDuplicate(null)}>
            {t('cancel')}
          </button>
        </div>
      ) : null}

      <div className="card">
        {/* 1 — card */}
        <div className="field">
          <label htmlFor="card-select">1. {t('chooseCard')}</label>
          <select id="card-select" value={cardId} onChange={(e) => setCardId(e.target.value)}>
            <option value="">— {t('chooseCard')} —</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname} · ••{c.last4} · {c.ownership === 'COMPANY' ? t('company') : t('personal')} · {tCurrency(c.native_currency)}
              </option>
            ))}
          </select>
        </div>

        {card && card.ownership === 'COMPANY' ? (
          <Callout tone="info">{t('companyCashWithdrawn')} — {t('notAnExpense')}</Callout>
        ) : null}
        {card && card.network === 'MASTERCARD' && card.international_status !== 'CONFIRMED_WORKING' ? (
          <>
            <div className="spacer" />
            <Callout tone="warn">{t('mastercardWarning')}</Callout>
          </>
        ) : null}
        <div className="spacer" />

        {/* 2 — cash actually received */}
        <AmountField
          label={`2. ${t('cashReceived')}`}
          value={cash}
          onChange={setCash}
          currency="SAR"
          hint={t('cashNotDispensed') + ' → 0'}
        />

        {/* 3, 4 — balances */}
        <AmountField label={`3. ${t('balanceBefore')}`} value={before} onChange={setBefore} currency={nativeCur} />
        <AmountField label={`4. ${t('balanceAfter')}`} value={after} onChange={setAfter} currency={nativeCur} />

        {/* 5 — DCC */}
        <Choice<Exclude<Dcc, null>>
          label={`5. ${t('dccQuestion')}`}
          columns={3}
          value={dcc}
          onChange={setDcc}
          options={[
            { value: 'LOCAL', label: t('dccChoseSar') },
            { value: 'BILLING', label: t('dccChoseCard') },
            { value: 'NOT_OFFERED', label: t('no') },
          ]}
          hint={t('dccAdvice')}
        />

        {/* 6 — optional ATM fee */}
        <AmountField
          label={`6. ${t('atmFee')} (${t('optional')})`}
          value={atmFee}
          onChange={setAtmFee}
          currency="SAR"
        />

        {full ? (
          <>
            <AmountField label={`${t('requestedAmount')} (${t('optional')})`} value={requested} onChange={setRequested} currency="SAR" />
            <div className="field">
              <label htmlFor="op">{t('atmOperator')}</label>
              <input id="op" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="loc">{t('atmLocation')}</label>
              <input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="term">{t('atmTerminalId')}</label>
              <input id="term" value={terminal} onChange={(e) => setTerminal(e.target.value)} autoComplete="off" />
            </div>
            <Choice
              label={t('balanceSource')}
              columns={3}
              value={balanceSource}
              onChange={setBalanceSource}
              options={[
                { value: 'BANK_APP' as const, label: t('bankApp') },
                { value: 'SMS' as const, label: t('sms') },
                { value: 'ATM_RECEIPT' as const, label: t('atmReceipt') },
              ]}
            />
            <div className="field">
              <label htmlFor="notes">{t('notes')}</label>
              <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </>
        ) : null}

        <button type="button" className="primary" disabled={!canSave} onClick={() => void save(false)}>
          {busy ? t('saving') : `${t('saveWithdrawal')}${cashMinor ? ` — ${money(cashMinor, 'SAR')}` : ''}`}
        </button>
        <button type="button" className="link" onClick={() => setFull((f) => !f)}>
          {full ? t('quickWithdrawal') : `${t('fullMode')} +`}
        </button>
      </div>
    </>
  );
}
