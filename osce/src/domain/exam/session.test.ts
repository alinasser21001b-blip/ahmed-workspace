import { describe, expect, it } from 'vitest';
import { emptySeededStore } from '../../data/store';
import {
  beginQuestioning,
  createExamSession,
  maybeAdvanceTimer,
  recordAnswer,
  resolveCase,
  resolveExaminer,
  startPreparation,
  completeExam,
  advanceQuestion,
} from './session';
import { DomainError } from '../invariants';
import { remainingSeconds } from '../../lib/ids';
import { computeExamScores } from './scoring';

function knowledge() {
  const store = emptySeededStore();
  return {
    examiners: store.examiners,
    cases: store.cases,
    questions: store.questions,
    examinerQuestions: store.examinerQuestions,
  };
}

function clock(seed = 0.42) {
  let n = seed;
  return {
    now: () => new Date('2026-08-28T10:00:00.000Z'),
    random: () => {
      n = (n * 9301 + 49297) % 233280;
      return n / 233280;
    },
  };
}

describe('exam session invariants', () => {
  it('random examiner belongs to the selected specialty', () => {
    const k = knowledge();
    const c = clock();
    const session = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'RANDOM',
        preparationDuration: 240,
      },
      k,
      c,
    );
    const examiner = k.examiners.find((e) => e.id === session.examinerId);
    expect(examiner?.departmentId).toBe('pediatrics');
    expect(session.specialtyId).toBe('pediatrics');
  });

  it('random case belongs to the selected examiner', () => {
    const k = knowledge();
    const session = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'RANDOM',
        preparationDuration: 180,
      },
      k,
      clock(0.11),
    );
    const allowed = k.examinerQuestions
      .filter((eq) => eq.examinerId === session.examinerId)
      .map((eq) => eq.caseId);
    expect(allowed).toContain(session.caseId);
    const clinicalCase = k.cases.find((row) => row.id === session.caseId);
    expect(clinicalCase?.departmentId).toBe('pediatrics');
  });

  it('manual examiner selection is respected and not replaced', () => {
    const k = knowledge();
    const session = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'SELECTED',
        examinerId: 'ex_ahmed_peds',
        preparationDuration: 180,
      },
      k,
      clock(),
    );
    expect(session.examinerId).toBe('ex_ahmed_peds');
    const caseIds = k.examinerQuestions
      .filter((eq) => eq.examinerId === 'ex_ahmed_peds')
      .map((eq) => eq.caseId);
    expect(caseIds).toContain(session.caseId);
  });

  it('rejects a surgery examiner in a pediatrics exam', () => {
    const k = knowledge();
    expect(() =>
      createExamSession(
        {
          specialtyId: 'pediatrics',
          examinerMode: 'SELECTED',
          examinerId: 'ex_karim_surg',
          preparationDuration: 180,
        },
        k,
        clock(),
      ),
    ).toThrow(DomainError);
  });

  it('rejects a case not associated with the examiner', () => {
    const k = knowledge();
    const examiner = k.examiners.find((e) => e.id === 'ex_ahmed_peds');
    expect(examiner).toBeTruthy();
    expect(() =>
      resolveCase(k, examiner!, 'SELECTED', 'case_dka', Math.random),
    ).toThrow(/not historically associated/);
  });

  it('question sequence comes only from the examiner–case pool', () => {
    const k = knowledge();
    const session = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'SELECTED',
        examinerId: 'ex_ahmed_peds',
        caseMode: 'SELECTED',
        caseId: 'case_nephrotic',
        preparationDuration: 240,
      },
      k,
      clock(),
    );
    expect(session.questionSequence.length).toBeGreaterThanOrEqual(10);
    for (const questionId of session.questionSequence) {
      const link = k.examinerQuestions.find(
        (eq) =>
          eq.examinerId === 'ex_ahmed_peds' &&
          eq.caseId === 'case_nephrotic' &&
          eq.questionId === questionId,
      );
      expect(link).toBeTruthy();
    }
  });

  it('initializes preparation from timestamps rather than a decrementing counter', () => {
    const k = knowledge();
    const c = clock();
    const created = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'SELECTED',
        examinerId: 'ex_hassan_peds',
        preparationDuration: 180,
      },
      k,
      c,
    );
    const started = startPreparation(created, c);
    expect(started.status).toBe('PREPARATION');
    expect(started.startedAt).toBe('2026-08-28T10:00:00.000Z');
    expect(started.preparationEndsAt).toBe('2026-08-28T10:03:00.000Z');
    expect(remainingSeconds(started.preparationEndsAt!, Date.parse('2026-08-28T10:01:10.000Z'))).toBe(110);
  });

  it('auto-advances from preparation to questioning when the timestamp has passed', () => {
    const k = knowledge();
    const c = clock();
    const started = startPreparation(
      createExamSession(
        {
          specialtyId: 'surgery',
          examinerMode: 'RANDOM',
          preparationDuration: 180,
        },
        k,
        c,
      ),
      c,
    );
    const advanced = maybeAdvanceTimer(started, Date.parse('2026-08-28T10:03:01.000Z'));
    expect(advanced.status).toBe('QUESTIONING');
  });

  it('persists answers and completes with a score', () => {
    const k = knowledge();
    const created = createExamSession(
      {
        specialtyId: 'pediatrics',
        examinerMode: 'SELECTED',
        examinerId: 'ex_ahmed_peds',
        caseMode: 'SELECTED',
        caseId: 'case_nephrotic',
        preparationDuration: 180,
      },
      k,
      clock(),
    );
    const questioning = beginQuestioning(startPreparation(created, clock()), clock());
    const q1 = questioning.questionSequence[0]!;
    const answered = recordAnswer(
      questioning,
      {
        questionId: q1,
        studentAnswer: 'Nephrotic syndrome',
        answeredAt: '2026-08-28T10:04:00.000Z',
        revealedAt: '2026-08-28T10:04:00.000Z',
        correctness: 'CORRECT',
        score: 1,
        selfEvaluated: true,
      },
      k,
    );
    expect(answered.answers).toHaveLength(1);
    expect(answered.answers[0]?.questionId).toBe(q1);

    const completed = completeExam(
      { ...answered, currentQuestionIndex: questioning.questionSequence.length - 1 },
      k,
      clock(),
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.scores).toBeTruthy();
    expect(completed.scores?.totalQuestions).toBe(questioning.questionSequence.length);
  });

  it('does not allow advancing without an answer', () => {
    const k = knowledge();
    const questioning = beginQuestioning(
      startPreparation(
        createExamSession(
          {
            specialtyId: 'pediatrics',
            examinerMode: 'SELECTED',
            examinerId: 'ex_ahmed_peds',
            preparationDuration: 180,
          },
          k,
          clock(),
        ),
        clock(),
      ),
      clock(),
    );
    expect(() => advanceQuestion(questioning)).toThrow(/Evaluate/);
  });
});

describe('resolveExaminer', () => {
  it('never returns an examiner from another department', () => {
    const k = knowledge();
    for (let i = 0; i < 20; i += 1) {
      const examiner = resolveExaminer(k, 'pediatrics', 'RANDOM', null, () => i / 20);
      expect(examiner.departmentId).toBe('pediatrics');
    }
  });
});

describe('scoring', () => {
  it('counts correct, partial, and incorrect', () => {
    const scores = computeExamScores(
      ['a', 'b', 'c'],
      [
        { questionId: 'a', studentAnswer: '', answeredAt: '', correctness: 'CORRECT', score: 1, selfEvaluated: true },
        { questionId: 'b', studentAnswer: '', answeredAt: '', correctness: 'PARTIAL', score: 0.5, selfEvaluated: true },
        { questionId: 'c', studentAnswer: '', answeredAt: '', correctness: 'INCORRECT', score: 0, selfEvaluated: true },
      ],
      [
        {
          id: 'a',
          caseId: 'x',
          questionText: '',
          expectedAnswer: '',
          category: 'Diagnosis',
          difficulty: 'standard',
          sourceDocumentIds: [],
          sample: true,
          canonicalQuestion: '',
          observedVariants: [],
        },
        {
          id: 'b',
          caseId: 'x',
          questionText: '',
          expectedAnswer: '',
          category: 'Complications',
          difficulty: 'standard',
          sourceDocumentIds: [],
          sample: true,
          canonicalQuestion: '',
          observedVariants: [],
        },
        {
          id: 'c',
          caseId: 'x',
          questionText: '',
          expectedAnswer: '',
          category: 'Complications',
          difficulty: 'standard',
          sourceDocumentIds: [],
          sample: true,
          canonicalQuestion: '',
          observedVariants: [],
        },
      ],
    );
    expect(scores.percent).toBe(50);
    expect(scores.correct).toBe(1);
    expect(scores.partial).toBe(1);
    expect(scores.incorrect).toBe(1);
    expect(scores.strong).toContain('Diagnosis');
    expect(scores.needsReview).toContain('Complications');
  });
});
