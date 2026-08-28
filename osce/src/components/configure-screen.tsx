'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Disclaimer, LocaleToggle, SampleBanner } from '@/components/chrome';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { api, rememberSession } from '@/lib/client-api';
import { DEFAULT_PREPARATION_OPTIONS_SECONDS, SPECIALTIES, isSpecialtyId } from '@/domain/models';
import type { ExaminerSummary, PresentedSession } from '@/lib/types';

export function ConfigureScreen() {
  const params = useParams<{ specialtyId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { locale } = useLocale();
  const c = t(locale);
  const specialtyId = params.specialtyId;
  const mode = search.get('mode') === 'SELECTED' ? 'SELECTED' : 'RANDOM';
  const examinerId = search.get('examinerId');
  const specialty = isSpecialtyId(specialtyId) ? SPECIALTIES.find((s) => s.id === specialtyId) : undefined;

  const [duration, setDuration] = useState(240);
  const [examiner, setExaminer] = useState<ExaminerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'SELECTED' || !examinerId || !isSpecialtyId(specialtyId)) return;
    api<{ examiners: ExaminerSummary[] }>(`/api/specialties/${specialtyId}/examiners`).then((data) => {
      setExaminer(data.examiners.find((row) => row.id === examinerId) ?? null);
    });
  }, [mode, examinerId, specialtyId]);

  const options = useMemo(() => [...DEFAULT_PREPARATION_OPTIONS_SECONDS], []);

  async function start() {
    if (!isSpecialtyId(specialtyId)) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ session: PresentedSession }>('/api/exam-sessions', {
        method: 'POST',
        body: JSON.stringify({
          specialtyId,
          examinerMode: mode,
          examinerId: mode === 'SELECTED' ? examinerId : null,
          preparationDuration: duration,
        }),
      });
      rememberSession(created.session.id);
      router.push(`/exam/${created.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : c.error);
      setBusy(false);
    }
  }

  if (!specialty) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">OSCE</span>
        </div>
        <LocaleToggle />
      </header>
      <main id="main" className="page">
        <Link className="back-link" href={mode === 'SELECTED' ? `/s/${specialty.id}/examiners` : `/s/${specialty.id}`}>
          {c.back}
        </Link>
        <p className="kicker">{c.stationReady}</p>
        <h1>{c.startOsce}</h1>
        <SampleBanner />
        <div className="configure">
          <section className="summary-card">
            <p className="kicker">{locale === 'ar' ? specialty.nameAr : specialty.nameEn}</p>
            <h2>
              {mode === 'RANDOM'
                ? c.randomExaminer
                : locale === 'ar'
                  ? examiner?.nameAr ?? c.chooseExaminer
                  : examiner?.name ?? c.chooseExaminer}
            </h2>
            <p className="lede" style={{ marginBottom: 0 }}>
              {mode === 'RANDOM' ? c.examinerWillBeAssigned : c.randomExaminerHint}
            </p>
          </section>
          <section>
            <h2>{c.preparation}</h2>
            <div className="duration-row" role="group" aria-label={c.preparation}>
              {options.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  className="duration-btn"
                  aria-pressed={duration === seconds}
                  onClick={() => setDuration(seconds)}
                  data-testid={`prep-${seconds}`}
                >
                  {seconds / 60} {c.minutes}
                </button>
              ))}
            </div>
          </section>
          {error && <p role="alert">{error}</p>}
          <button className="primary-btn" type="button" onClick={start} disabled={busy} data-testid="start-osce">
            {busy ? c.loading : `${c.startOsce} · ${c.startOsceEn}`}
          </button>
        </div>
        <Disclaimer />
      </main>
    </div>
  );
}
