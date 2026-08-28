'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Disclaimer, LocaleToggle, SampleBanner } from '@/components/chrome';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { SPECIALTIES, isSpecialtyId } from '@/domain/models';

export function ExaminerModeScreen() {
  const params = useParams<{ specialtyId: string }>();
  const { locale } = useLocale();
  const c = t(locale);
  const specialtyId = params.specialtyId;
  const specialty = isSpecialtyId(specialtyId) ? SPECIALTIES.find((s) => s.id === specialtyId) : undefined;

  if (!specialty) {
    return (
      <main id="main" className="page">
        <p>{c.error}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">OSCE</span>
        </div>
        <LocaleToggle />
      </header>
      <main id="main" className="page">
        <Link className="back-link" href="/">
          {c.back}
        </Link>
        <p className="kicker">{locale === 'ar' ? specialty.nameAr : specialty.nameEn}</p>
        <h1>{locale === 'ar' ? 'من سيفحصك؟' : 'Who will examine you?'}</h1>
        <SampleBanner />
        <div className="choice-stack">
          <Link
            className="choice-card"
            href={`/s/${specialty.id}/configure?mode=RANDOM`}
            data-testid="random-examiner"
          >
            <h2>{c.randomExaminer}</h2>
            <p>{c.randomExaminerHint}</p>
          </Link>
          <Link
            className="choice-card"
            href={`/s/${specialty.id}/examiners`}
            data-testid="choose-examiner"
          >
            <h2>{c.chooseExaminer}</h2>
            <p>{c.chooseExaminerHint}</p>
          </Link>
        </div>
        <Disclaimer />
      </main>
    </div>
  );
}
