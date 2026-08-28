'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Disclaimer, LocaleToggle } from '@/components/chrome';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { api } from '@/lib/client-api';
import { SPECIALTIES, type ExtractionCandidate, type SpecialtyId } from '@/domain/models';

type DocumentRow = {
  id: string;
  filename: string;
  fileType: string;
  uploadedAt: string;
  processingStatus: string;
  department?: string;
  sourceYear?: number;
  error?: string;
  version: number;
};

export function AdminScreen() {
  const { locale } = useLocale();
  const c = t(locale);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [candidates, setCandidates] = useState<ExtractionCandidate[]>([]);
  const [department, setDepartment] = useState<SpecialtyId | ''>('');
  const [year, setYear] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const docs = await api<{ documents: DocumentRow[] }>('/api/knowledge/documents');
    const review = await api<{ candidates: ExtractionCandidate[] }>('/api/knowledge/review');
    setDocuments(docs.documents);
    setCandidates(review.candidates);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('file');
    if (!(fileInput instanceof HTMLInputElement) || !fileInput.files?.[0]) return;
    const data = new FormData();
    data.append('file', fileInput.files[0]);
    if (department) data.append('department', department);
    if (year) data.append('sourceYear', year);
    setMessage(c.processing);
    await fetch('/api/knowledge/documents', { method: 'POST', body: data });
    await refresh();
    setMessage(null);
    form.reset();
  }

  async function decide(candidateId: string, decision: 'APPROVED' | 'REJECTED') {
    await api('/api/knowledge/review', {
      method: 'POST',
      body: JSON.stringify({ candidateId, decision }),
    });
    await refresh();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="wordmark">OSCE</span>
        </Link>
        <LocaleToggle />
      </header>
      <main id="main" className="admin-page">
        <p className="kicker">{c.admin}</p>
        <h1>{c.upload}</h1>
        <p className="lede">
          {locale === 'ar'
            ? 'ارفع ملفات الاستذكار. النص الأصلي يُحفظ، والاستخراج غير المؤكد ينتظر المراجعة ولا يدخل بنك الامتحان بصمت.'
            : 'Upload recall files. Raw text is kept. Uncertain extractions wait for review and never silently enter the exam bank.'}
        </p>
        <form className="upload-panel" onSubmit={(event) => void onUpload(event)}>
          <label>
            {c.upload}
            <input type="file" name="file" accept=".txt,.md,.markdown,.pdf,.docx" required />
          </label>
          <div style={{ height: 12 }} />
          <label>
            {locale === 'ar' ? 'الاختصاص (اختياري)' : 'Specialty (optional)'}
            <select value={department} onChange={(event) => setDepartment(event.target.value as SpecialtyId | '')}>
              <option value="">{locale === 'ar' ? 'غير محدد' : 'Unspecified'}</option>
              {SPECIALTIES.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {locale === 'ar' ? specialty.nameAr : specialty.nameEn}
                </option>
              ))}
            </select>
          </label>
          <div style={{ height: 12 }} />
          <label>
            {locale === 'ar' ? 'سنة المصدر' : 'Source year'}
            <input className="search" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} />
          </label>
          <div style={{ height: 12 }} />
          <button className="primary-btn" type="submit">
            {c.upload}
          </button>
          {message && <p>{message}</p>}
        </form>

        <h2>{c.processing}</h2>
        {documents.map((doc) => (
          <article key={doc.id} className="doc-row">
            <strong>{doc.filename}</strong>
            <div>
              <span className="status-chip">{doc.processingStatus}</span> · v{doc.version}
            </div>
            {doc.error && <p>{doc.error}</p>}
          </article>
        ))}

        <h2>{c.review}</h2>
        {candidates.length === 0 && <p>{c.noPending}</p>}
        {candidates.map((candidate) => (
          <article key={candidate.id} className="review-card">
            <p className={`confidence-${candidate.band}`}>
              {candidate.band} · {candidate.confidence}
            </p>
            <p>
              {candidate.examinerName} — {candidate.caseTitle}
            </p>
            <p>
              <strong>{candidate.questionText}</strong>
            </p>
            <p>{candidate.expectedAnswer}</p>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--muted)' }}>{candidate.sourceText}</pre>
            <div className="duration-row">
              <button className="primary-btn" type="button" onClick={() => void decide(candidate.id, 'APPROVED')}>
                {c.approve}
              </button>
              <button className="secondary-btn" type="button" onClick={() => void decide(candidate.id, 'REJECTED')}>
                {c.reject}
              </button>
            </div>
          </article>
        ))}
        <Disclaimer />
      </main>
    </div>
  );
}
