import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { money, formatSaudiTime } from '../lib/format.ts';
import { t, tState, tCurrency } from '../i18n.ts';
import { ErrorBox, Loading, StateBadge } from '../components/Common.tsx';

interface Row {
  id: string; state: string; ownership: string; transaction_at: string;
  dispensed_sar_minor: string; nickname: string; native_currency: string; last4: string;
  posted_debit_minor: string | null; pending_debit_minor: string | null; day_close_id: string | null;
}

type Scope = 'ALL' | 'PERSONAL' | 'COMPANY';

export function Withdrawals({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scope, setScope] = useState<Scope>('ALL');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .get<{ withdrawals: Row[] }>(`/v1/withdrawals${scope === 'ALL' ? '' : `?scope=${scope}`}`)
      .then((r) => setRows(r.withdrawals))
      .catch((e) => setError((e as Error).message));
  };
  useEffect(load, [scope]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!rows) return <Loading />;

  return (
    <>
      <div className="scope" role="group">
        {(['ALL', 'PERSONAL', 'COMPANY'] as Scope[]).map((s) => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
            {s === 'ALL' ? t('all') : s === 'PERSONAL' ? t('personal') : t('company')}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card"><div className="muted">{t('noData')}</div></div>
      ) : (
        <div className="list">
          {rows.map((r) => (
            <button key={r.id} type="button" className="item" onClick={() => onOpen(r.id)}>
              <div className="top">
                <span className="amt num">{money(r.dispensed_sar_minor, 'SAR')}</span>
                <StateBadge state={r.state} label={tState(r.state)} />
              </div>
              <div className="meta">
                <span>{r.nickname} ••{r.last4}</span>
                <span>{r.ownership === 'COMPANY' ? t('company') : t('personal')}</span>
                <span className="num">{formatSaudiTime(r.transaction_at)}</span>
              </div>
              <div className="meta">
                {r.posted_debit_minor ? (
                  <span>
                    {t('postedDebit')}: <span className="num">{money(r.posted_debit_minor, r.native_currency)}</span>
                  </span>
                ) : r.pending_debit_minor ? (
                  <span>
                    {t('pendingDebit')}: <span className="num">{money(r.pending_debit_minor, r.native_currency)}</span>
                  </span>
                ) : (
                  <span>{tCurrency(r.native_currency)}</span>
                )}
                {r.day_close_id ? <span>🔒 {t('dayClosed')}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
