import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { money, toMinor, todayRiyadh } from '../lib/format.ts';
import { t, tConfidence, tCurrency, getLocale, setLocale } from '../i18n.ts';
import { AmountField, Callout, Choice, ErrorBox, Figure, Loading, Sheet, type EvidencedWire } from '../components/Common.tsx';

type Tab = 'menu' | 'planner' | 'comparison' | 'dayclose' | 'exports' | 'sources' | 'expense';

export function More({ user, onLogout }: { user: { role: string; displayName: string }; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('menu');
  if (tab === 'planner') return <Planner onBack={() => setTab('menu')} />;
  if (tab === 'comparison') return <Comparison onBack={() => setTab('menu')} />;
  if (tab === 'dayclose') return <DayClose onBack={() => setTab('menu')} />;
  if (tab === 'exports') return <Exports onBack={() => setTab('menu')} isAdmin={user.role === 'ADMIN'} />;
  if (tab === 'sources') return <Sources onBack={() => setTab('menu')} />;
  if (tab === 'expense') return <Expense onBack={() => setTab('menu')} />;

  const items: { key: Tab; label: string; icon: string }[] = [
    { key: 'planner', label: t('planner'), icon: '🧭' },
    { key: 'comparison', label: t('comparison'), icon: '⚖️' },
    { key: 'dayclose', label: t('dayClose'), icon: '🌙' },
    { key: 'expense', label: t('addExpense'), icon: '🧾' },
    { key: 'exports', label: t('exports'), icon: '📤' },
    { key: 'sources', label: t('sources'), icon: '📚' },
  ];

  return (
    <>
      <div className="list">
        {items.map((i) => (
          <button key={i.key} type="button" className="item" onClick={() => setTab(i.key)}>
            <div className="top">
              <span className="amt" style={{ fontSize: '1rem' }}>
                <span aria-hidden="true" style={{ marginInlineEnd: 8 }}>{i.icon}</span>
                {i.label}
              </span>
              <span aria-hidden="true">›</span>
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        <h2>{t('language')}</h2>
        <Choice
          label={t('language')}
          value={getLocale()}
          onChange={(v) => { setLocale(v); location.reload(); }}
          options={[{ value: 'ar' as const, label: t('arabic') }, { value: 'en' as const, label: t('english') }]}
        />
      </div>

      <div className="card">
        <div className="row">
          <span className="k">{user.displayName}</span>
          <span className="v">{user.role}</span>
        </div>
        <div className="spacer" />
        <button type="button" className="danger-btn" onClick={onLogout}>{t('logout')}</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ planner
interface Plan {
  allocations: {
    cardId: string; nickname: string; ownership: string; sarMinor: string; sarDisplay: string;
    withdrawalCount: number; perWithdrawalSarMinor: string; estimatedCostNative: EvidencedWire;
    rateBasis: string; bindingConstraint: string; notes: string[];
  }[];
  allocatedSarMinor: string; shortfallSarMinor: string;
  unusable: { cardId: string; nickname: string; reason: string }[];
  totalEstimatedCostIqd: EvidencedWire;
  disclaimer: string; overallConfidence: string;
}

function Planner({ onBack }: { onBack: () => void }) {
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState<'ALL' | 'PERSONAL' | 'COMPANY'>('ALL');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const minor = toMinor(target, 'SAR');
    if (!minor) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.post<Plan>('/v1/planner', { targetSarMinor: minor, ownership: scope }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>
      <div className="card">
        <h2>{t('planner')}</h2>
        <AmountField label={t('plannerPrompt')} value={target} onChange={setTarget} currency="SAR" autoFocus />
        <Choice label={t('ownership')} columns={3} value={scope} onChange={setScope}
          options={[
            { value: 'ALL' as const, label: t('all') },
            { value: 'PERSONAL' as const, label: t('personal') },
            { value: 'COMPANY' as const, label: t('company') },
          ]} />
        <button type="button" className="primary" disabled={busy || !toMinor(target, 'SAR')} onClick={() => void run()}>
          {busy ? t('loading') : t('buildPlan')}
        </button>
      </div>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {plan ? (
        <>
          <div className="card">
            <h2>{t('suggestedPlan')}</h2>
            {plan.allocations.length === 0 ? (
              <div className="muted">{t('insufficientData')}</div>
            ) : (
              plan.allocations.map((a) => (
                <div key={a.cardId} style={{ borderBottom: '1px solid var(--surface-2)', paddingBottom: 10, marginBottom: 10 }}>
                  <div className="row">
                    <span className="k strong">{a.nickname}</span>
                    <span className="v num" style={{ fontSize: '1.15rem' }}>{money(a.sarMinor, 'SAR')}</span>
                  </div>
                  <div className="row">
                    <span className="k">{t('withdrawalsNeeded')}</span>
                    <span className="v num">{a.withdrawalCount} × {money(a.perWithdrawalSarMinor, 'SAR')}</span>
                  </div>
                  <Figure label={t('estimatedCost')} value={a.estimatedCostNative} />
                  <div className="tiny">
                    {a.rateBasis === 'VERIFIED' ? t('basisVerified') : t('basisReference')} · {t('bindingConstraint')}: {a.bindingConstraint}
                  </div>
                  {a.notes.map((n, i) => (
                    <div className="tiny" key={i}>• {n}</div>
                  ))}
                </div>
              ))
            )}
            {BigInt(plan.shortfallSarMinor) > 0n ? (
              <Callout tone="warn">{t('planShortfall')}: {money(plan.shortfallSarMinor, 'SAR')}</Callout>
            ) : null}
            <div className="spacer" />
            <Figure label={t('estimatedCost')} value={plan.totalEstimatedCostIqd} />
            <div className="row">
              <span className="k">{t('confidence')}</span>
              <span className="v">{tConfidence(plan.overallConfidence)}</span>
            </div>
          </div>

          {plan.unusable.length > 0 ? (
            <div className="card">
              <h2>{t('planUnusable')}</h2>
              {plan.unusable.map((u) => (
                <div className="row" key={u.cardId}>
                  <span className="k strong">{u.nickname}</span>
                  <span className="v" style={{ fontWeight: 400, fontSize: '.85rem' }}>{u.reason}</span>
                </div>
              ))}
            </div>
          ) : null}

          <Callout tone="info">{t('planDisclaimer')}</Callout>
        </>
      ) : null}
    </>
  );
}

// --------------------------------------------------------------- comparison
interface Comparison2 {
  message: string;
  best: { cardId: string; nickname: string; averageIqdPerSar: string; sampleCount: number; confidence: string } | null;
  rows: {
    cardId: string; nickname: string; issuer: string; ownership: string; nativeCurrency: string;
    lastSettledNativePerSar: string | null; rollingAverageNativePerSar: string | null;
    lastSettledIqdPerSar: string | null; rollingAverageIqdPerSar: string | null;
    totalFees: string; dccUsedCount: number; atmOperators: string[]; sampleCount: number;
    confidence: string; comparableInIqd: boolean;
  }[];
}

function Comparison({ onBack }: { onBack: () => void }) {
  const [d, setD] = useState<Comparison2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Comparison2>('/v1/comparison').then(setD).catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <ErrorBox message={error} />;
  if (!d) return <Loading />;

  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>
      {d.best ? (
        <div className="card">
          <h2>{t('bestVerifiedOption')}</h2>
          <div className="stat">
            <span className="label">{d.best.nickname}</span>
            <span className="value num">{d.best.averageIqdPerSar} IQD / SAR</span>
          </div>
          <div className="row">
            <span className="k">{t('confidence')}</span>
            <span className="v">{tConfidence(d.best.confidence)} · {d.best.sampleCount} {t('samples')}</span>
          </div>
        </div>
      ) : (
        <Callout tone="info">{t('insufficientData')}</Callout>
      )}
      <div className="card">
        <h2>{t('comparison')}</h2>
        <div className="tiny" style={{ marginBottom: 10 }}>{d.message}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('card')}</th><th>{t('nativeCurrency')}</th><th>{t('lastSettledRate')}</th>
                <th>{t('avgVerifiedRate')}</th><th>IQD/SAR</th><th>{t('verifiedFees')}</th>
                <th>DCC</th><th>{t('samples')}</th><th>{t('confidence')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.cardId}>
                  <td>{r.nickname}</td>
                  <td>{tCurrency(r.nativeCurrency)}</td>
                  <td className="num">{r.lastSettledNativePerSar ?? '—'}</td>
                  <td className="num">{r.rollingAverageNativePerSar ?? '—'}</td>
                  <td className="num">{r.comparableInIqd ? (r.rollingAverageIqdPerSar ?? '—') : t('notComparableUsd')}</td>
                  <td className="num">{r.totalFees}</td>
                  <td className="num">{r.dccUsedCount}</td>
                  <td className="num">{r.sampleCount}</td>
                  <td>{tConfidence(r.confidence ?? "UNKNOWN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- day close
interface DayCloseView {
  date: string; status: string; closedAt: string | null;
  cards: {
    cardId: string; nickname: string; nativeCurrency: string;
    lastConfirmedBankBalance: EvidencedWire; expectedLedgerBalance: EvidencedWire; reconciliationDifference: EvidencedWire;
    pendingCount: number; unsettledCount: number; daySarWithdrawnMinor: string;
    dailyLimit: { minor: string; currency: string } | null;
  }[];
  wallets: {
    personal: { received: { minor: string }; spent: { minor: string }; expectedOnHand: { minor: string } };
    company: { received: { minor: string }; spent: { minor: string }; expectedOnHand: { minor: string } };
  };
}

function DayClose({ onBack }: { onBack: () => void }) {
  const [date, setDate] = useState(todayRiyadh());
  const [d, setD] = useState<DayCloseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.get<DayCloseView>(`/v1/day-close?date=${date}`).then(setD).catch((e) => setError((e as Error).message));
  };
  useEffect(load, [date]);
  if (!d) return <Loading />;

  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>
      <div className="card">
        <h2>{t('dayClose')}</h2>
        <div className="field">
          <label htmlFor="dt">{t('date')}</label>
          <input id="dt" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </div>
        {d.status === 'CLOSED' ? <Callout tone="ok">{t('dayClosed')}</Callout> : null}
      </div>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {d.cards.map((c) => (
        <div className="card" key={c.cardId}>
          <h2>{c.nickname}</h2>
          <Figure label={t('lastConfirmedBalance')} value={c.lastConfirmedBankBalance} />
          <Figure label={t('expectedLedgerBalance')} value={c.expectedLedgerBalance} />
          <Figure label={t('difference')} value={c.reconciliationDifference} />
          <div className="row"><span className="k">{t('pending')}</span><span className="v num">{c.pendingCount}</span></div>
          <div className="row"><span className="k">{t('unsettled')}</span><span className="v num">{c.unsettledCount}</span></div>
          <div className="row"><span className="k">{t('todayWithdrawn')}</span><span className="v num">{money(c.daySarWithdrawnMinor, 'SAR')}</span></div>
          <div className="row"><span className="k">{t('dailyLimit')}</span><span className="v num">{c.dailyLimit ? money(c.dailyLimit.minor, c.dailyLimit.currency) : '—'}</span></div>
        </div>
      ))}

      <div className="card">
        <h2>{t('expectedCashOnHand')}</h2>
        <div className="row"><span className="k">{t('personalCash')} — {t('received')}</span><span className="v num">{money(d.wallets.personal.received.minor, 'SAR')}</span></div>
        <div className="row"><span className="k">{t('personalCash')} — {t('spent')}</span><span className="v num">{money(d.wallets.personal.spent.minor, 'SAR')}</span></div>
        <div className="row"><span className="k">{t('personalCash')}</span><span className="v num">{money(d.wallets.personal.expectedOnHand.minor, 'SAR')}</span></div>
        <div className="row"><span className="k">{t('companyCash')} — {t('received')}</span><span className="v num">{money(d.wallets.company.received.minor, 'SAR')}</span></div>
        <div className="row"><span className="k">{t('companyCash')} — {t('spent')}</span><span className="v num">{money(d.wallets.company.spent.minor, 'SAR')}</span></div>
        <div className="row"><span className="k">{t('companyCash')}</span><span className="v num">{money(d.wallets.company.expectedOnHand.minor, 'SAR')}</span></div>
      </div>

      {d.status !== 'CLOSED' ? (
        <div className="card">
          <Callout tone="warn">{t('dayCloseLocks')}</Callout>
          <div className="spacer" />
          <button type="button" className="primary" disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try { await api.post('/v1/day-close', { date }); load(); }
              catch (e) { setError((e as Error).message); }
              finally { setBusy(false); }
            }}>{t('closeDay')}</button>
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ exports
function Exports({ onBack, isAdmin }: { onBack: () => void; isAdmin: boolean }) {
  const links = [
    { href: '/v1/export/withdrawals.csv', label: t('exportWithdrawals') },
    { href: '/v1/export/withdrawals.csv?scope=COMPANY', label: t('exportCompany') },
    { href: '/v1/export/withdrawals.csv?scope=PERSONAL', label: t('exportPersonal') },
    { href: '/v1/export/reconciliation.csv', label: t('exportReconciliation') },
    { href: '/v1/export/treasury.csv', label: t('exportTreasury') },
    ...(isAdmin ? [{ href: '/v1/export/audit.csv', label: t('exportAudit') }] : []),
  ];
  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>
      <div className="card">
        <h2>{t('exports')}</h2>
        <div className="list">
          {links.map((l) => (
            <a key={l.href} className="item" href={l.href} download style={{ textDecoration: 'none' }}>
              <div className="top">
                <span className="amt" style={{ fontSize: '1rem' }}>📄 {l.label}</span>
                <span aria-hidden="true">↓</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

/** How a tariff rule's amount reads: a percentage, a range, a fixed amount, or
 *  — where the research found nothing — the word "unknown", never a zero. */
function feeRuleAmount(r: Record<string, string>): string {
  const currency = r.currency ?? 'IQD';
  if (r.percent) return `${r.percent}%`;
  if (String(r.amount_is_range) === 'true' && r.min_minor && r.max_minor) {
    return `${money(r.min_minor, currency)} – ${money(r.max_minor, currency)}`;
  }
  if (r.amount_minor) return money(r.amount_minor, currency);
  return t('unknown');
}

// ------------------------------------------------------------------ sources
function Sources({ onBack }: { onBack: () => void }) {
  const [sources, setSources] = useState<Record<string, string>[] | null>(null);
  const [rules, setRules] = useState<Record<string, string>[] | null>(null);
  const [rate, setRate] = useState({ base: 'SAR', quote: 'IQD', value: '', type: 'MID_MARKET', date: todayRiyadh() });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.get<{ sources: Record<string, string>[] }>('/v1/sources').then((r) => setSources(r.sources)).catch(() => setSources([]));
    api.get<{ rules: Record<string, string>[] }>('/v1/fee-rules').then((r) => setRules(r.rules)).catch(() => setRules([]));
  };
  useEffect(load, []);
  if (!sources || !rules) return <Loading />;

  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>

      <div className="card">
        <h2>{t('addReferenceRate')}</h2>
        <Callout tone="info">{t('referenceOnly')}</Callout>
        <div className="spacer" />
        <div className="field">
          <label htmlFor="rv">{t('rateValue')} ({rate.quote} / 1 {rate.base})</label>
          <input id="rv" inputMode="decimal" dir="ltr" value={rate.value} onChange={(e) => setRate({ ...rate, value: e.target.value })} />
        </div>
        <Choice label={t('rateType')} columns={3} value={rate.type} onChange={(v) => setRate({ ...rate, type: v })}
          options={[
            { value: 'OFFICIAL', label: 'OFFICIAL' }, { value: 'MID_MARKET', label: 'MID_MARKET' },
            { value: 'USER_ESTIMATE', label: 'USER_ESTIMATE' },
          ]} />
        <Choice label={t('nativeCurrency')} columns={2} value={rate.base}
          onChange={(v) => setRate({ ...rate, base: v, quote: 'IQD' })}
          options={[{ value: 'SAR', label: 'SAR → IQD' }, { value: 'USD', label: 'USD → IQD' }]} />
        <div className="field">
          <label htmlFor="ed">{t('effectiveDate')}</label>
          <input id="ed" type="date" dir="ltr" value={rate.date} onChange={(e) => setRate({ ...rate, date: e.target.value })} />
        </div>
        <button type="button" className="secondary" disabled={busy || !/^\d+(\.\d+)?$/.test(rate.value.trim())}
          onClick={async () => {
            setBusy(true); setMsg(null);
            try {
              await api.post('/v1/reference-rates', {
                baseCurrency: rate.base, quoteCurrency: rate.quote, rate: rate.value.trim(),
                rateType: rate.type, effectiveDate: rate.date,
              });
              setMsg(t('save'));
              setRate({ ...rate, value: '' });
            } catch (e) { setMsg((e as Error).message); }
            finally { setBusy(false); }
          }}>{t('save')}</button>
        {msg ? <div className="tiny" style={{ marginTop: 8 }}>{msg}</div> : null}
      </div>

      <div className="card">
        <h2>{t('feeRules')}</h2>
        <Callout tone="warn">{t('ruleConfidenceNote')}</Callout>
        <div className="spacer" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t('issuer')}</th><th>{t('product')}</th><th>{t('feeRules')}</th><th>{t('amount')}</th><th>{t('confidence')}</th><th>{t('effectiveDate')}</th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.issuer ?? '—'}</td>
                  <td>{r.product ?? t('all')}</td>
                  <td>{r.rule_type}</td>
                  <td className="num">{feeRuleAmount(r)}</td>
                  <td>{tConfidence(r.confidence ?? "UNKNOWN")}</td>
                  <td className="num">{String(r.effective_from).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{t('sources')}</h2>
        {sources.map((s) => (
          <div key={s.id} style={{ borderBottom: '1px solid var(--surface-2)', paddingBottom: 8, marginBottom: 8 }}>
            <div className="strong">{s.institution}</div>
            <div className="tiny">{s.title}</div>
            <div className="tiny">
              {s.source_class} · {s.retrieval_status} · {String(s.accessed_at).slice(0, 10)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ expense
function Expense({ onBack }: { onBack: () => void }) {
  const [amount, setAmount] = useState('');
  const [ownership, setOwnership] = useState<'PERSONAL' | 'COMPANY'>('PERSONAL');
  const [category, setCategory] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  return (
    <>
      <button type="button" className="link" onClick={onBack}>← {t('more')}</button>
      <div className="card">
        <h2>{t('addExpense')}</h2>
        {msg ? <Callout tone={msg.tone}>{msg.text}</Callout> : null}
        <div className="spacer" />
        <Choice label={t('ownership')} value={ownership} onChange={setOwnership}
          options={[{ value: 'PERSONAL' as const, label: t('personal') }, { value: 'COMPANY' as const, label: t('company') }]} />
        <AmountField label={t('expenseAmount')} value={amount} onChange={setAmount} currency="SAR" />
        <div className="field">
          <label htmlFor="cat">{t('category')}</label>
          <input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pur">{t('purpose')}</label>
          <input id="pur" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </div>
        <button type="button" className="primary" disabled={busy || !toMinor(amount, 'SAR')}
          onClick={async () => {
            setBusy(true); setMsg(null);
            try {
              await api.post('/v1/expenses', {
                ownership, amountMinor: toMinor(amount, 'SAR'),
                category: category.trim() || null, purpose: purpose.trim() || null,
              });
              setMsg({ tone: 'ok', text: t('save') });
              setAmount(''); setCategory(''); setPurpose('');
            } catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }); }
            finally { setBusy(false); }
          }}>{t('save')}</button>
      </div>
    </>
  );
}
