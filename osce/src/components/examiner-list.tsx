'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Disclaimer, LocaleToggle } from '@/components/chrome';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { api } from '@/lib/client-api';
import { formatUiCount, normalizeArabic } from '@/domain/text/arabic';
import { SPECIALTIES, isSpecialtyId } from '@/domain/models';
import type { ExaminerSummary } from '@/lib/types';

export function ExaminerListScreen() {
  const params = useParams<{ specialtyId: string }>();
  const { locale } = useLocale();
  const c = t(locale);
  const specialtyId = params.specialtyId;
  const specialty = isSpecialtyId(specialtyId) ? SPECIALTIES.find((s) => s.id === specialtyId) : undefined;
  const [examiners, setExaminers] = useState<ExaminerSummary[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isSpecialtyId(specialtyId)) return;
    api<{ examiners: ExaminerSummary[] }>(`/api/specialties/${specialtyId}/examiners`)
      .then((data) => setExaminers(data.examiners))
      .catch(() => undefined);
  }, [specialtyId]);

  const filtered = useMemo(() => {
    const q = normalizeArabic(query);
    if (!q) return examiners;
    return examiners.filter(
      (examiner) =>
        normalizeArabic(examiner.name).includes(q) || normalizeArabic(examiner.nameAr).includes(q),
    );
  }, [examiners, query]);

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
        <Link className="back-link" href={`/s/${specialty.id}`}>
          {c.back}
        </Link>
        <p className="kicker">{locale === 'ar' ? specialty.nameAr : specialty.nameEn}</p>
        <h1>{c.chooseExaminer}</h1>
        <label className="hidden" htmlFor="examiner-search">
          {c.searchExaminer}
        </label>
        <input
          id="examiner-search"
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={c.searchExaminer}
        />
        <div className="examiner-list">
          {filtered.map((examiner) => (
            <Link
              key={examiner.id}
              className="examiner-card"
              href={`/s/${specialty.id}/configure?mode=SELECTED&examinerId=${examiner.id}`}
              data-testid={`examiner-${examiner.id}`}
            >
              <h2>{locale === 'ar' ? examiner.nameAr : examiner.name}</h2>
              <div className="examiner-stats">
                <span>
                  {c.availableCases}: {formatUiCount(examiner.availableCases, locale)}
                </span>
                <span>
                  {c.historicalQuestions}: {formatUiCount(examiner.historicalQuestions, locale)}
                </span>
              </div>
            </Link>
          ))}
          {filtered.length === 0 && <p className="lede">{c.emptySearch}</p>}
        </div>
        <Disclaimer />
      </main>
    </div>
  );
}
