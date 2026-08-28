'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PrepTimer } from '@/components/prep-timer';
import { Disclaimer, LocaleToggle } from '@/components/chrome';
import { Bdi } from '@/components/bdi';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';
import { api, forgetSession, rememberSession } from '@/lib/client-api';
import { formatUiCount, selectPlural } from '@/domain/text/arabic';
import type { Correctness } from '@/domain/models';
import type { PresentedQuestion, PresentedSession } from '@/lib/types';

type Phase = 'loading' | 'examiner-reveal' | 'case-reveal' | 'preparation' | 'questioning' | 'results' | 'error';

export function ExamTheater() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { locale } = useLocale();
  const c = t(locale);
  const [session, setSession] = useState<PresentedSession | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<Correctness | undefined>();
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    const data = await api<{ session: PresentedSession }>(`/api/exam-sessions/${params.sessionId}`);
    rememberSession(data.session.id);
    setSession(data.session);
    return data.session;
  }, [params.sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await load();
        if (cancelled) return;
        if (current.status === 'COMPLETED') {
          setPhase('results');
          return;
        }
        if (current.status === 'QUESTIONING') {
          setPhase('questioning');
          return;
        }
        if (current.status === 'PREPARATION') {
          setPhase('preparation');
          return;
        }
        if (!startedRef.current) {
          startedRef.current = true;
          const started = await api<{ session: PresentedSession }>(`/api/exam-sessions/${current.id}/start`, {
            method: 'POST',
          });
          if (cancelled) return;
          setSession(started.session);
          setPhase('examiner-reveal');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : c.error);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [c.error, load]);

  useEffect(() => {
    if (phase !== 'examiner-reveal') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setPhase('case-reveal'), reduced ? 200 : 1400);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'case-reveal') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setPhase('preparation'), reduced ? 200 : 1200);
    return () => window.clearTimeout(id);
  }, [phase]);

  const currentQuestion: PresentedQuestion | undefined = useMemo(() => {
    if (!session) return undefined;
    return session.questions[session.currentQuestionIndex];
  }, [session]);

  useEffect(() => {
    if (!currentQuestion) return;
    setDraft(currentQuestion.answer?.studentAnswer ?? '');
    setRevealed(Boolean(currentQuestion.answer?.revealedAt || currentQuestion.expectedAnswer));
    setGrade(currentQuestion.answer?.correctness);
  }, [currentQuestion]);

  const beginQuestions = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      const data = await api<{ session: PresentedSession }>(`/api/exam-sessions/${session.id}/begin-questions`, {
        method: 'POST',
      });
      setSession(data.session);
      setPhase('questioning');
    } catch (err) {
      setError(err instanceof Error ? err.message : c.error);
    } finally {
      setBusy(false);
    }
  }, [busy, c.error, session]);

  async function revealAnswer() {
    if (!session || !currentQuestion || busy) return;
    setBusy(true);
    try {
      const data = await api<{ session: PresentedSession }>(`/api/exam-sessions/${session.id}/answers`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: currentQuestion.id,
          studentAnswer: draft,
        }),
      });
      setSession(data.session);
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : c.error);
    } finally {
      setBusy(false);
    }
  }

  async function submitGrade(nextGrade: Correctness) {
    if (!session || !currentQuestion || busy) return;
    setGrade(nextGrade);
    setBusy(true);
    try {
      const data = await api<{ session: PresentedSession }>(`/api/exam-sessions/${session.id}/answers`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: currentQuestion.id,
          studentAnswer: draft,
          correctness: nextGrade,
        }),
      });
      setSession(data.session);
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : c.error);
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    if (!session || !grade || busy) return;
    setBusy(true);
    try {
      const data = await api<{ session: PresentedSession }>(`/api/exam-sessions/${session.id}/advance`, {
        method: 'POST',
      });
      setSession(data.session);
      if (data.session.status === 'COMPLETED') {
        forgetSession();
        setPhase('results');
      } else {
        setPhase('questioning');
        setDraft('');
        setRevealed(false);
        setGrade(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : c.error);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (phase !== 'questioning') return;
      const target = event.target as HTMLElement | null;
      const inField = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!revealed) void revealAnswer();
        else if (grade) void goNext();
        return;
      }
      if (inField) return;
      if (!revealed && event.key === 'Enter') {
        event.preventDefault();
        void revealAnswer();
      }
      if (revealed && event.key === '1') void submitGrade('INCORRECT');
      if (revealed && event.key === '2') void submitGrade('PARTIAL');
      if (revealed && event.key === '3') void submitGrade('CORRECT');
      if (revealed && grade && event.key === 'Enter') {
        event.preventDefault();
        void goNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (phase === 'loading') {
    return (
      <main className="exam-stage">
        <p className="page">{c.loading}</p>
      </main>
    );
  }

  if (phase === 'error' || !session) {
    return (
      <main className="page">
        <p role="alert">{error ?? c.error}</p>
        <Link href="/">{c.back}</Link>
      </main>
    );
  }

  const examinerName = locale === 'ar' ? session.examiner?.nameAr : session.examiner?.name;
  const caseTitle = locale === 'ar' ? session.case?.titleAr ?? session.case?.title : session.case?.title;

  if (phase === 'examiner-reveal') {
    return (
      <div className="exam-stage" data-testid="examiner-reveal" id="main">
        <div className="reveal">
          <p className="kicker">{c.yourExaminer}</p>
          <h1>{examinerName}</h1>
        </div>
      </div>
    );
  }

  if (phase === 'case-reveal') {
    return (
      <div className="exam-stage" data-testid="case-reveal">
        <div className="reveal">
          <p className="kicker">{c.yourCase}</p>
          <h1>
            <Bdi>{caseTitle}</Bdi>
          </h1>
        </div>
      </div>
    );
  }

  if (phase === 'preparation' && session.preparationEndsAt) {
    return (
      <div className="exam-stage" data-testid="preparation" id="main">
        <header className="exam-header">
          <span>{examinerName}</span>
          <LocaleToggle />
        </header>
        <main className="prep-layout">
          <p className="kicker">{c.yourCase}</p>
          <PrepTimer endsAt={session.preparationEndsAt} onElapsed={() => void beginQuestions()} />
          <article className="case-sheet">
            <h1>
              <Bdi>{caseTitle}</Bdi>
            </h1>
            <p className="scenario">{session.case?.clinicalScenario}</p>
          </article>
          <div style={{ height: 16 }} />
          <button className="primary-btn" type="button" onClick={() => void beginQuestions()} data-testid="start-questions">
            {c.startExamNow}
          </button>
          <Disclaimer />
        </main>
      </div>
    );
  }

  if (phase === 'questioning' && currentQuestion) {
    const n = session.currentQuestionIndex + 1;
    const total = session.questionCount;
    const evaluation = session.questions[session.currentQuestionIndex]?.answer?.evaluation;
    const isLast = session.currentQuestionIndex >= session.questionCount - 1;
    return (
      <div className="exam-stage" data-testid="questioning" id="main">
        <header className="exam-header">
          <span>
            {c.question} {formatUiCount(n, locale)} {c.of} {formatUiCount(total, locale)}
          </span>
          <LocaleToggle />
        </header>
        <article className="question-card">
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${(n / total) * 100}%` }} />
          </div>
          <div className="meta-row">
            <span>{examinerName}</span>
            <span>
              <Bdi>{caseTitle}</Bdi>
            </span>
            {currentQuestion.category && (
              <span>
                <Bdi>{currentQuestion.category}</Bdi>
              </span>
            )}
          </div>
          <h2 className="question-text">{currentQuestion.questionText}</h2>
          <label className="kicker" htmlFor="student-answer">
            {c.studentAnswer}
          </label>
          <textarea
            id="student-answer"
            className="answer-box"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={c.studentAnswerHint}
            data-testid="student-answer"
          />
          {!revealed && (
            <div style={{ marginTop: 14 }}>
              <button className="primary-btn" type="button" onClick={() => void revealAnswer()} data-testid="show-answer">
                {c.showAnswer}
              </button>
            </div>
          )}
          {revealed && currentQuestion.expectedAnswer && (
            <section className="expected" data-testid="expected-answer">
              <h3>{c.expectedAnswer}</h3>
              <p>{currentQuestion.expectedAnswer}</p>
              {currentQuestion.explanation && (
                <>
                  <h3>{c.explanation}</h3>
                  <p>{currentQuestion.explanation}</p>
                </>
              )}
              {evaluation && (
                <>
                  <h3>{c.autoEval}</h3>
                  <p>{evaluation.feedback}</p>
                  {evaluation.coveredPoints.length > 0 && (
                    <p>
                      {c.covered}: {evaluation.coveredPoints.join(' · ')}
                    </p>
                  )}
                  {evaluation.missingPoints.length > 0 && (
                    <p>
                      {c.missing}: {evaluation.missingPoints.join(' · ')}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {revealed && (
            <div className="grade-row" role="group" aria-label="self evaluation">
              <button
                type="button"
                className="grade-btn"
                data-tone="incorrect"
                aria-pressed={grade === 'INCORRECT'}
                onClick={() => void submitGrade('INCORRECT')}
                data-testid="grade-incorrect"
              >
                {c.incorrect}
              </button>
              <button
                type="button"
                className="grade-btn"
                data-tone="partial"
                aria-pressed={grade === 'PARTIAL'}
                onClick={() => void submitGrade('PARTIAL')}
                data-testid="grade-partial"
              >
                {c.partial}
              </button>
              <button
                type="button"
                className="grade-btn"
                data-tone="correct"
                aria-pressed={grade === 'CORRECT'}
                onClick={() => void submitGrade('CORRECT')}
                data-testid="grade-correct"
              >
                {c.correct}
              </button>
            </div>
          )}
          {revealed && grade && (
            <button className="primary-btn" type="button" onClick={() => void goNext()} data-testid="next-question">
              {isLast ? c.finish : c.next}
            </button>
          )}
          <p className="kbd-hint">{c.keyboard}</p>
          {error && <p role="alert">{error}</p>}
        </article>
      </div>
    );
  }

  const scores = session.scores;
  return (
    <div className="exam-stage" data-testid="results" id="main">
      <header className="exam-header">
        <span className="wordmark">OSCE</span>
        <LocaleToggle />
      </header>
      <main className="results">
        <p className="kicker">{c.osceComplete}</p>
        <h1>{examinerName}</h1>
        <p className="lede">
          <Bdi>{caseTitle}</Bdi>
        </p>
        <p className="score-number">{scores ? `${scores.percent}%` : '—'}</p>
        {scores && (
          <div className="stat-row">
            <div className="stat">
              <b>{formatUiCount(scores.correct, locale)}</b>
              <span>{c.correct}</span>
            </div>
            <div className="stat">
              <b>{formatUiCount(scores.partial, locale)}</b>
              <span>{c.partial}</span>
            </div>
            <div className="stat">
              <b>{formatUiCount(scores.incorrect, locale)}</b>
              <span>{c.incorrect}</span>
            </div>
          </div>
        )}
        {scores && scores.strong.length > 0 && (
          <section>
            <h2>{c.strong}</h2>
            <p>
              {scores.strong.map((item) => (
                <Bdi key={item}>{item}</Bdi>
              ))}
            </p>
          </section>
        )}
        {scores && scores.needsReview.length > 0 && (
          <section>
            <h2>{c.needsReview}</h2>
            <p>
              {scores.needsReview.map((item) => (
                <span key={item}>
                  <Bdi>{item}</Bdi>{' '}
                </span>
              ))}
            </p>
          </section>
        )}
        {scores && scores.missedQuestionIds.length > 0 && (
          <section>
            <h2>{c.missed}</h2>
            <ul className="list-plain">
              {scores.missedQuestionIds.map((id) => {
                const question = session.questions.find((row) => row.id === id);
                return <li key={id}>{question?.questionText}</li>;
              })}
            </ul>
          </section>
        )}
        <p className="lede">
          {selectPlural(locale, session.questionCount, {
            one: locale === 'ar' ? 'سؤال واحد' : '1 question',
            two: 'سؤالان',
            few: `${formatUiCount(session.questionCount, locale)} أسئلة`,
            other: `${formatUiCount(session.questionCount, locale)} ${c.questions}`,
          })}
        </p>
        <button className="primary-btn" type="button" onClick={() => router.push('/')}>
          {c.again}
        </button>
        <Disclaimer />
      </main>
    </div>
  );
}
