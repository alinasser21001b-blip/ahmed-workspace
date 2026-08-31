import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { money, toMinor } from '../lib/format.ts';
import { t, tConfidence, tCurrency } from '../i18n.ts';
import { AmountField, Callout, Choice, ErrorBox, Figure, Loading, Sheet, type EvidencedWire } from '../components/Common.tsx';

interface CardRow {
  id: string; nickname: string; issuer: string; product: string; network: string; card_type: string;
  last4: string; ownership: 'PERSONAL' | 'COMPANY'; native_currency: string;
  opening_available_minor: string | null; daily_atm_limit_minor: string | null; daily_atm_limit_currency: string | null;
  international_status: string; is_active: boolean; notes: string | null;
}

interface CardDash {
  card: { nickname: string; issuer: string; product: string; last4: string; ownership: string; nativeCurrency: string; internationalStatus: string };
  openingBalance: { minor: string; currency: string } | null;
  expectedLedgerBalance: EvidencedWire;
  lastConfirmedBankBalance: EvidencedWire;
  reconciliationDifference: EvidencedWire;
  hasUnexplainedDifference: boolean;
  todaySarWithdrawnMinor: string;
  dailyLimit: { minor: string; currency: string } | null;
  remainingTodayMinor: string | null;
  pendingTotalMinor: string; settledTotalMinor: string; nativeCurrency: string;
  verifiedAverageRate: { display: string; label: string } | null;
  lastSettledRate: { display: string } | null;
  sampleCount: number; dataConfidence: string; comparableInIqd: boolean; confidenceReason: string;
  withdrawalCount: number;
}

export function Cards() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dash, setDash] = useState<CardDash | null>(null);
  const [sheet, setSheet] = useState<null | 'add' | 'balance' | 'funding'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [f, setF] = useState({
    nickname: '', issuer: '', product: '', network: 'VISA', cardType: 'DEBIT', last4: '',
    ownership: 'PERSONAL' as 'PERSONAL' | 'COMPANY', nativeCurrency: 'IQD',
    opening: '', dailyLimit: '', intlStatus: 'UNKNOWN',
  });
  const [balAmt, setBalAmt] = useState('');
  const [balSource, setBalSource] = useState<'BANK_APP' | 'STATEMENT' | 'SMS'>('BANK_APP');
  const [fundCredited, setFundCredited] = useState('');
  const [fundIqd, setFundIqd] = useState('');
  const [fundFee, setFundFee] = useState('');

  const loadCards = () => {
    api.get<{ cards: CardRow[] }>('/v1/cards').then((r) => setCards(r.cards)).catch((e) => setError((e as Error).message));
  };
  useEffect(loadCards, []);
  useEffect(() => {
    if (!open) { setDash(null); return; }
    api.get<CardDash>(`/v1/cards/${open}/dashboard`).then(setDash).catch((e) => setError((e as Error).message));
  }, [open]);

  if (error) return <ErrorBox message={error} onRetry={() => { setError(null); loadCards(); }} />;
  if (!cards) return <Loading />;

  const current = cards.find((c) => c.id === open) ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setSheet(null);
      loadCards();
      if (open) api.get<CardDash>(`/v1/cards/${open}/dashboard`).then(setDash).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (current && dash) {
    const cur = dash.nativeCurrency;
    return (
      <>
        <button type="button" className="link" onClick={() => setOpen(null)}>← {t('cards')}</button>
        <div className="card">
          <h2>{dash.card.nickname} ••{dash.card.last4}</h2>
          <div className="row"><span className="k">{t('issuer')}</span><span className="v">{dash.card.issuer}</span></div>
          <div className="row"><span className="k">{t('product')}</span><span className="v">{dash.card.product}</span></div>
          <div className="row"><span className="k">{t('ownership')}</span><span className="v">{dash.card.ownership === 'COMPANY' ? t('company') : t('personal')}</span></div>
          <div className="row"><span className="k">{t('nativeCurrency')}</span><span className="v">{tCurrency(cur)}</span></div>
          <div className="row">
            <span className="k">{t('intlStatus')}</span>
            <span className="v">
              {dash.card.internationalStatus === 'CONFIRMED_WORKING' ? t('intlConfirmed')
                : dash.card.internationalStatus === 'CLAIMED_BY_ISSUER' ? t('intlClaimed')
                : dash.card.internationalStatus === 'RESTRICTED_BY_REGULATION' ? t('intlRestricted')
                : t('intlUnknown')}
            </span>
          </div>
        </div>

        {current.network === 'MASTERCARD' && dash.card.internationalStatus !== 'CONFIRMED_WORKING' ? (
          <Callout tone="warn">{t('mastercardWarning')}</Callout>
        ) : null}

        <div className="card">
          <h2>{t('reconcile')}</h2>
          <div className="row">
            <span className="k">{t('openingBalance')}</span>
            <span className="v num">{dash.openingBalance ? money(dash.openingBalance.minor, cur) : '—'}</span>
          </div>
          <Figure label={t('expectedLedgerBalance')} value={dash.expectedLedgerBalance} />
          <Figure label={t('lastConfirmedBalance')} value={dash.lastConfirmedBankBalance} />
          <Figure label={t('difference')} value={dash.reconciliationDifference} big />
          {dash.hasUnexplainedDifference ? (
            <>
              <div className="spacer" />
              <Callout tone="danger">{t('unexplainedDifference')}</Callout>
            </>
          ) : null}
          <div className="spacer" />
          <button type="button" className="secondary" onClick={() => setSheet('balance')}>{t('addSnapshot')}</button>
        </div>

        <div className="card">
          <h2>{t('withdrawals')}</h2>
          <div className="row"><span className="k">{t('todayWithdrawn')}</span><span className="v num">{money(dash.todaySarWithdrawnMinor, 'SAR')}</span></div>
          <div className="row"><span className="k">{t('dailyLimit')}</span><span className="v num">{dash.dailyLimit ? money(dash.dailyLimit.minor, dash.dailyLimit.currency) : '—'}</span></div>
          {dash.remainingTodayMinor ? (
            <div className="row"><span className="k">{t('remainingToday')}</span><span className="v num">{money(dash.remainingTodayMinor, 'SAR')}</span></div>
          ) : null}
          <div className="row"><span className="k">{t('pendingTotal')}</span><span className="v num">{money(dash.pendingTotalMinor, cur)}</span></div>
          <div className="row"><span className="k">{t('settledTotal')}</span><span className="v num">{money(dash.settledTotalMinor, cur)}</span></div>
        </div>

        <div className="card">
          <h2>{t('effectiveRate')}</h2>
          <div className="row">
            <span className="k">{t('avgVerifiedRate')}</span>
            <span className="v num">{dash.verifiedAverageRate ? dash.verifiedAverageRate.label : t('notEnoughEvidence')}</span>
          </div>
          <div className="row">
            <span className="k">{t('lastSettledRate')}</span>
            <span className="v num">{dash.lastSettledRate ? dash.lastSettledRate.display : '—'}</span>
          </div>
          <div className="row">
            <span className="k">{t('dataConfidence')}</span>
            <span className="v">{tConfidence(dash.dataConfidence)} · {dash.sampleCount} {t('samples')}</span>
          </div>
          <div className="tiny" style={{ marginTop: 8 }}>{dash.confidenceReason}</div>
          {!dash.comparableInIqd && cur !== 'IQD' ? (
            <>
              <div className="spacer" />
              <Callout tone="info">{t('fundingWhy')}</Callout>
              <div className="spacer" />
              <button type="button" className="secondary" onClick={() => setSheet('funding')}>{t('addFunding')}</button>
            </>
          ) : null}
        </div>

        {cur !== 'IQD' ? (
          <div className="card">
            <h2>{t('addFunding')}</h2>
            <div className="tiny">{t('fundingWhy')}</div>
            <div className="spacer" />
            <button type="button" className="secondary" onClick={() => setSheet('funding')}>{t('addFunding')}</button>
          </div>
        ) : null}

        {sheet === 'balance' ? (
          <Sheet title={t('addSnapshot')} onClose={() => setSheet(null)}>
            <AmountField label={t('amount')} value={balAmt} onChange={setBalAmt} currency={cur} autoFocus />
            <Choice
              label={t('balanceSource')} columns={3} value={balSource} onChange={setBalSource}
              options={[
                { value: 'BANK_APP' as const, label: t('bankApp') },
                { value: 'STATEMENT' as const, label: t('statement') },
                { value: 'SMS' as const, label: t('sms') },
              ]}
            />
            <button type="button" className="primary" disabled={busy || !toMinor(balAmt, cur)}
              onClick={() => void act(() => api.post(`/v1/cards/${open}/snapshots`, {
                amountMinor: toMinor(balAmt, cur), source: balSource, balanceType: 'AVAILABLE',
              }))}>{t('save')}</button>
          </Sheet>
        ) : null}

        {sheet === 'funding' ? (
          <Sheet title={t('addFunding')} onClose={() => setSheet(null)}>
            <Callout tone="info">{t('fundingWhy')}</Callout>
            <div className="spacer" />
            <AmountField label={t('fundingCredited')} value={fundCredited} onChange={setFundCredited} currency={cur} autoFocus />
            <AmountField label={t('fundingIqdPaid')} value={fundIqd} onChange={setFundIqd} currency="IQD" />
            <AmountField label={`${t('fundingFee')} (${t('optional')})`} value={fundFee} onChange={setFundFee} currency="IQD" />
            <button type="button" className="primary" disabled={busy || !toMinor(fundCredited, cur)}
              onClick={() => void act(() => api.post(`/v1/cards/${open}/funding`, {
                creditedMinor: toMinor(fundCredited, cur),
                iqdPaidMinor: fundIqd.trim() ? toMinor(fundIqd, 'IQD') : null,
                fundingFeeMinor: fundFee.trim() ? toMinor(fundFee, 'IQD') : null,
                source: 'MANUAL',
              }))}>{t('save')}</button>
          </Sheet>
        ) : null}
      </>
    );
  }

  return (
    <>
      <button type="button" className="primary" onClick={() => setSheet('add')}>＋ {t('addCard')}</button>
      {cards.length === 0 ? (
        <div className="card"><div className="muted">{t('noData')}</div></div>
      ) : (
        <div className="list">
          {cards.map((c) => (
            <button key={c.id} type="button" className="item" onClick={() => setOpen(c.id)}>
              <div className="top">
                <span className="amt">{c.nickname}</span>
                <span className="badge muted">••{c.last4}</span>
              </div>
              <div className="meta">
                <span>{c.issuer}</span>
                <span>{c.ownership === 'COMPANY' ? t('company') : t('personal')}</span>
                <span>{tCurrency(c.native_currency)}</span>
              </div>
              {c.international_status !== 'CONFIRMED_WORKING' ? (
                <div className="meta"><span className="badge warn"><span aria-hidden="true">!</span>{t('intlUnknown')}</span></div>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {sheet === 'add' ? (
        <Sheet title={t('addCard')} onClose={() => setSheet(null)}>
          <Callout tone="danger">{t('last4Warning')}</Callout>
          <div className="spacer" />
          <div className="field">
            <label htmlFor="nn">{t('nickname')}</label>
            <input id="nn" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="iss">{t('issuer')}</label>
            <input id="iss" list="issuers" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} />
            <datalist id="issuers">
              <option value="NEO Iraq" /><option value="National Bank of Iraq" /><option value="Rafidain Bank / Qi Card" />
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="prod">{t('product')}</label>
            <input id="prod" list="products" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} />
            <datalist id="products">
              <option value="NEO 964" /><option value="NEO Classic" /><option value="NEO Platinum" />
              <option value="NBI Debit" /><option value="Qi Mastercard" /><option value="Qi Visa" />
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="l4">{t('last4')}</label>
            <input id="l4" inputMode="numeric" maxLength={4} dir="ltr" value={f.last4}
              onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </div>
          <Choice label={t('ownership')} value={f.ownership} onChange={(v) => setF({ ...f, ownership: v })}
            options={[{ value: 'PERSONAL' as const, label: t('personal') }, { value: 'COMPANY' as const, label: t('company') }]} />
          <Choice label={t('nativeCurrency')} columns={3} value={f.nativeCurrency} onChange={(v) => setF({ ...f, nativeCurrency: v })}
            options={[{ value: 'IQD', label: tCurrency('IQD') }, { value: 'USD', label: tCurrency('USD') }, { value: 'SAR', label: tCurrency('SAR') }]} />
          <Choice label={t('network')} columns={3} value={f.network} onChange={(v) => setF({ ...f, network: v })}
            options={[{ value: 'VISA', label: 'Visa' }, { value: 'MASTERCARD', label: 'Mastercard' }, { value: 'UNKNOWN', label: t('unknown') }]} />
          <Choice label={t('cardType')} columns={2} value={f.cardType} onChange={(v) => setF({ ...f, cardType: v })}
            options={[
              { value: 'DEBIT', label: t('debit') }, { value: 'PREPAID', label: t('prepaid') },
              { value: 'CREDIT', label: t('credit') }, { value: 'CORPORATE', label: t('corporate') },
            ]} />
          <Choice label={t('intlStatus')} columns={2} value={f.intlStatus} onChange={(v) => setF({ ...f, intlStatus: v })}
            options={[
              { value: 'CONFIRMED_WORKING', label: t('intlConfirmed') }, { value: 'CLAIMED_BY_ISSUER', label: t('intlClaimed') },
              { value: 'RESTRICTED_BY_REGULATION', label: t('intlRestricted') }, { value: 'UNKNOWN', label: t('intlUnknown') },
            ]} />
          <AmountField label={`${t('openingBalance')} (${t('optional')})`} value={f.opening} onChange={(v) => setF({ ...f, opening: v })} currency={f.nativeCurrency} />
          <AmountField label={`${t('dailyLimit')} (${t('optional')})`} value={f.dailyLimit} onChange={(v) => setF({ ...f, dailyLimit: v })} currency={f.nativeCurrency} />
          <button type="button" className="primary"
            disabled={busy || !f.nickname.trim() || !f.issuer.trim() || !f.product.trim() || f.last4.length !== 4}
            onClick={() => void act(() => api.post('/v1/cards', {
              nickname: f.nickname.trim(), issuer: f.issuer.trim(), product: f.product.trim(),
              network: f.network, cardType: f.cardType, last4: f.last4, ownership: f.ownership,
              nativeCurrency: f.nativeCurrency, internationalStatus: f.intlStatus,
              openingAvailableMinor: f.opening.trim() ? toMinor(f.opening, f.nativeCurrency) : null,
              dailyAtmLimitMinor: f.dailyLimit.trim() ? toMinor(f.dailyLimit, f.nativeCurrency) : null,
              dailyAtmLimitCurrency: f.dailyLimit.trim() ? f.nativeCurrency : null,
            }))}>{t('save')}</button>
        </Sheet>
      ) : null}
    </>
  );
}
