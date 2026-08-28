'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Splash } from '@/components/splash';
import { SpecialtyIcon } from '@/components/specialty-icon';
import { Disclaimer, LocaleToggle, SampleBanner } from '@/components/chrome';
import { Bdi } from '@/components/bdi';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { api, readRememberedSession } from '@/lib/client-api';
import { formatUiCount, selectPlural } from '@/domain/text/arabic';
import type { SpecialtySummary } from '@/lib/types';

export function HomeScreen() {
  const { locale } = useLocale();
  const c = t(locale);
  const [ready, setReady] = useState(false);
  const [specialties, setSpecialties] = useState<SpecialtySummary[]>([]);
  const [activeExam, setActiveExam] = useState<string | null>(null);

  const finishSplash = useCallback(() => setReady(true), []);

  useEffect(() => {
    api<{ specialties: SpecialtySummary[] }>('/api/specialties')
      .then((data) => setSpecialties(data.specialties))
      .catch(() => undefined);
    setActiveExam(readRememberedSession());
  }, []);

  return (
    <>
      {!ready && <Splash onDone={finishSplash} />}
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <span className="wordmark">OSCE</span>
            <span className="brand-sub">{c.educational}</span>
          </div>
          <div className="topbar-actions">
            <Link className="admin-link" href="/admin">
              {c.admin}
            </Link>
            <LocaleToggle />
          </div>
        </header>
        <main id="main" className="page">
          <p className="kicker">{c.tagline}</p>
          <h1>{c.chooseSpecialty}</h1>
          <p className="lede">{c.chooseSpecialtyHint}</p>
          <SampleBanner />
          {activeExam && (
            <p>
              <Link className="primary-btn" href={`/exam/${activeExam}`} style={{ display: 'inline-flex', width: 'auto', padding: '0 20px', alignItems: 'center' }}>
                {c.continueExam}
              </Link>
            </p>
          )}
          <div className="specialty-grid">
            {specialties.map((specialty) => (
              <Link
                key={specialty.id}
                href={`/s/${specialty.id}`}
                className="specialty-card"
                data-testid={`specialty-${specialty.id}`}
                style={{ ['--accent' as string]: specialty.accent }}
              >
                <span className="enamel" style={{ background: specialty.accent }}>
                  <SpecialtyIcon id={specialty.id} />
                </span>
                <div>
                  <h2>{locale === 'ar' ? specialty.shortAr : specialty.shortEn}</h2>
                  <p>
                    <Bdi>{locale === 'ar' ? specialty.nameEn : specialty.nameAr}</Bdi>
                  </p>
                </div>
                <div className="specialty-meta">
                  <div>
                    {selectPlural(locale, specialty.examinerCount, {
                      one: locale === 'ar' ? 'فاحص واحد' : '1 examiner',
                      two: 'فاحصان',
                      few: `${formatUiCount(specialty.examinerCount, locale)} فاحصين`,
                      many: `${formatUiCount(specialty.examinerCount, locale)} فاحصًا`,
                      other:
                        locale === 'ar'
                          ? `${formatUiCount(specialty.examinerCount, locale)} فاحص`
                          : `${formatUiCount(specialty.examinerCount, locale)} ${c.examiners}`,
                    })}
                  </div>
                  <div>
                    {selectPlural(locale, specialty.questionCount, {
                      one: locale === 'ar' ? 'سؤال واحد' : '1 question',
                      two: 'سؤالان',
                      few: `${formatUiCount(specialty.questionCount, locale)} أسئلة`,
                      many: `${formatUiCount(specialty.questionCount, locale)} سؤالًا`,
                      other:
                        locale === 'ar'
                          ? `${formatUiCount(specialty.questionCount, locale)} سؤال`
                          : `${formatUiCount(specialty.questionCount, locale)} ${c.historicalQuestions}`,
                    })}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Disclaimer />
        </main>
      </div>
    </>
  );
}
