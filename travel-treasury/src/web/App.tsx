import { useCallback, useEffect, useState } from 'react';
import { api, isOnline, loadCsrf, readQueue, setCsrf, syncQueue, type ApiError } from './lib/api.ts';
import { getLocale, setLocale, t } from './i18n.ts';
import { Callout } from './components/Common.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Home } from './pages/Home.tsx';
import { Withdraw } from './pages/Withdraw.tsx';
import { Withdrawals } from './pages/Withdrawals.tsx';
import { WithdrawalDetail } from './pages/WithdrawalDetail.tsx';
import { Cards } from './pages/Cards.tsx';
import { More } from './pages/More.tsx';

interface User {
  id: string; email: string; role: 'TRAVELER' | 'ADMIN'; displayName: string; locale: 'ar' | 'en';
}

type Tab = 'home' | 'withdraw' | 'list' | 'cards' | 'more';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [queued, setQueued] = useState(readQueue().length);
  const [flash, setFlash] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setLocale(getLocale());
    loadCsrf();
    api
      .get<{ user: User }>('/v1/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const refreshQueue = useCallback(() => setQueued(readQueue().length), []);

  const doSync = useCallback(async () => {
    const out = await syncQueue();
    refreshQueue();
    if (out.synced > 0) {
      setFlash(`${t('syncNow')} ✓ ${out.synced}`);
      setNonce((n) => n + 1);
    }
  }, [refreshQueue]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void doSync();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (isOnline() && readQueue().length > 0) void doSync();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [doSync]);

  if (user === undefined) {
    return <div className="center"><div className="muted">{t('loading')}</div></div>;
  }
  if (user === null) return <Login onSignedIn={setUser} />;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'home', label: t('home'), icon: '🏠' },
    { key: 'withdraw', label: t('withdraw'), icon: '💵' },
    { key: 'list', label: t('withdrawals'), icon: '📋' },
    { key: 'cards', label: t('cards'), icon: '💳' },
    { key: 'more', label: t('more'), icon: '☰' },
  ];

  return (
    <div className="app">
      <header className="header">
        <h1>{t('appName')}</h1>
        <button type="button" onClick={() => { setLocale(getLocale() === 'ar' ? 'en' : 'ar'); location.reload(); }}>
          {getLocale() === 'ar' ? 'EN' : 'ع'}
        </button>
      </header>

      {!online ? (
        <div className="offline-bar">
          <span aria-hidden="true">⚠</span> {t('offline')}
        </div>
      ) : null}

      <main key={nonce}>
        {flash ? <Callout tone="ok">{flash}</Callout> : null}
        {queued > 0 ? (
          <div className="card">
            <Callout tone="warn">
              {t('offlineDrafts')}: {queued}
            </Callout>
            <div className="spacer" />
            <button type="button" className="secondary" disabled={!online} onClick={() => void doSync()}>
              {t('syncNow')}
            </button>
          </div>
        ) : null}

        <ErrorBoundary key={`${tab}-${detailId ?? ''}-${nonce}`} onReset={() => setNonce((n) => n + 1)}>
        {detailId ? (
          <WithdrawalDetail id={detailId} onBack={() => setDetailId(null)} />
        ) : tab === 'home' ? (
          <Home onGoWithdraw={() => setTab('withdraw')} />
        ) : tab === 'withdraw' ? (
          <Withdraw
            onSaved={(id) => {
              refreshQueue();
              setTab('list');
              if (id) setDetailId(id);
            }}
          />
        ) : tab === 'list' ? (
          <Withdrawals onOpen={setDetailId} />
        ) : tab === 'cards' ? (
          <Cards />
        ) : (
          <More
            user={user}
            onLogout={async () => {
              try {
                await api.post('/v1/auth/logout');
              } catch {
                /* already gone */
              }
              setCsrf(null);
              setUser(null);
            }}
          />
        )}
        </ErrorBoundary>
      </main>

      <nav className="tabbar" aria-label={t('appName')}>
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-current={tab === x.key && !detailId ? 'page' : undefined}
            onClick={() => {
              setDetailId(null);
              setTab(x.key);
              setNonce((n) => n + 1);
            }}
          >
            <span className="ic" aria-hidden="true">{x.icon}</span>
            <span>{x.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ csrfToken: string; user: User }>('/v1/auth/login', { email, password });
      setCsrf(r.csrfToken);
      onSignedIn(r.user);
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.errorAr ?? ae.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>{t('appName')}</h1>
        <button type="button" onClick={() => { setLocale(getLocale() === 'ar' ? 'en' : 'ar'); location.reload(); }}>
          {getLocale() === 'ar' ? 'EN' : 'ع'}
        </button>
      </header>
      <main>
        <div className="login-wrap">
          <form className="card" onSubmit={submit}>
            <h2>{t('login')}</h2>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <div className="spacer" />
            <div className="field">
              <label htmlFor="em">{t('email')}</label>
              <input id="em" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="pw">{t('password')}</label>
              <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t('loading') : t('login')}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
