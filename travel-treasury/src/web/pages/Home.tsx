import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { money, formatSaudiTime } from '../lib/format.ts';
import { t } from '../i18n.ts';
import { Callout, ErrorBox, Loading, StateBadge } from '../components/Common.tsx';
import { tState } from '../i18n.ts';

type Scope = 'ALL' | 'PERSONAL' | 'COMPANY';

interface Dashboard {
  scope: Scope;
  treasury: {
    personal: { received: { minor: string; currency: string }; spent: { minor: string; currency: string }; expectedOnHand: { minor: string; currency: string } };
    company: { received: { minor: string; currency: string }; spent: { minor: string; currency: string }; expectedOnHand: { minor: string; currency: string } };
    totalReceived: { minor: string; currency: string };
  };
  withdrawals: {
    totalDispensedSarMinor: string;
    count: number;
    byState: Record<string, { n: number; sarMinor: string }>;
    openDiscrepancies: number;
  };
  verifiedFees: { currency: string; totalMinor: string }[];
  referenceRates: { pair: string; rate: string; rateType: string; effectiveDate: string }[];
  generatedAt: string;
}

export function Home({ onGoWithdraw }: { onGoWithdraw: () => void }) {
  const [scope, setScope] = useState<Scope>('ALL');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .get<Dashboard>(`/v1/dashboard?scope=${scope}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  };
  useEffect(load, [scope]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading />;

  const wallet = scope === 'COMPANY' ? data.treasury.company : scope === 'PERSONAL' ? data.treasury.personal : null;
  const totalSar = scope === 'ALL' ? data.treasury.totalReceived : wallet!.received;

  const states = Object.entries(data.withdrawals.byState);

  return (
    <>
      <div className="scope" role="group" aria-label={t('all')}>
        {(['ALL', 'PERSONAL', 'COMPANY'] as Scope[]).map((s) => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
            {s === 'ALL' ? t('all') : s === 'PERSONAL' ? t('personal') : t('company')}
          </button>
        ))}
      </div>

      <button type="button" className="primary" onClick={onGoWithdraw} style={{ minHeight: 72, fontSize: '1.25rem' }}>
        <span aria-hidden="true">＋ </span>
        {t('quickWithdrawal')}
      </button>

      <div className="card">
        <div className="stat">
          <span className="label">{t('totalWithdrawn')}</span>
          <span className="value num">{money(totalSar.minor, 'SAR')}</span>
        </div>
        <div className="spacer" />
        <div className="grid2">
          <div className="stat">
            <span className="label">{t('personalCash')}</span>
            <span className="value sm num">{money(data.treasury.personal.received.minor, 'SAR')}</span>
          </div>
          <div className="stat">
            <span className="label">{t('companyCashWithdrawn')}</span>
            <span className="value sm num">{money(data.treasury.company.received.minor, 'SAR')}</span>
          </div>
        </div>
        <div className="tiny" style={{ marginTop: 8 }}>{t('notAnExpense')}</div>
      </div>

      <div className="card">
        <h2>{t('expectedCashOnHand')}</h2>
        <div className="row">
          <span className="k">{t('personalCash')}</span>
          <span className="v num">{money(data.treasury.personal.expectedOnHand.minor, 'SAR')}</span>
        </div>
        <div className="row">
          <span className="k">{t('companyCash')}</span>
          <span className="v num">{money(data.treasury.company.expectedOnHand.minor, 'SAR')}</span>
        </div>
        <div className="tiny" style={{ marginTop: 8 }}>
          {t('received')} − {t('spent')}
        </div>
      </div>

      <div className="card">
        <h2>{t('withdrawals')}</h2>
        <div className="row">
          <span className="k">{t('withdrawalCount')}</span>
          <span className="v num">{data.withdrawals.count}</span>
        </div>
        {states.length === 0 ? (
          <div className="muted">{t('noData')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {states.map(([s, v]) => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <StateBadge state={s} label={`${tState(s)} · ${v.n}`} />
              </span>
            ))}
          </div>
        )}
      </div>

      {data.withdrawals.openDiscrepancies > 0 ? (
        <Callout tone="danger">
          <span className="strong">
            {t('openDiscrepancies')}: {data.withdrawals.openDiscrepancies}
          </span>
        </Callout>
      ) : null}

      <div className="card">
        <h2>{t('verifiedFees')}</h2>
        {data.verifiedFees.length === 0 ? (
          <div className="muted">{t('noData')}</div>
        ) : (
          data.verifiedFees.map((f) => (
            <div className="row" key={f.currency}>
              <span className="k">{f.currency}</span>
              <span className="v num">{money(f.totalMinor, f.currency)}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>{t('referenceRates')}</h2>
        {data.referenceRates.length === 0 ? (
          <div className="muted">{t('noData')}</div>
        ) : (
          data.referenceRates.map((r) => (
            <div className="row" key={r.pair + r.rateType}>
              <span className="k">
                {r.pair} · {r.rateType}
              </span>
              <span className="v num">{r.rate}</span>
            </div>
          ))
        )}
        <div className="tiny" style={{ marginTop: 8 }}>{t('referenceOnly')}</div>
      </div>

      <div className="tiny" style={{ textAlign: 'center' }}>
        {t('lastSync')}: {formatSaudiTime(data.generatedAt)} ({t('saudiTime')})
      </div>
    </>
  );
}
