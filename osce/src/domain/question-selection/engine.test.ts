import { describe, expect, it } from 'vitest';
import { selectQuestionSequence } from './engine';
import { emptySeededStore } from '../../data/store';

describe('question selection engine', () => {
  it('never mixes another examiner or case into the sequence', () => {
    const store = emptySeededStore();
    const sequence = selectQuestionSequence(
      {
        departmentId: 'pediatrics',
        examinerId: 'ex_ahmed_peds',
        caseId: 'case_nephrotic',
        examinerQuestions: store.examinerQuestions,
        questions: store.questions,
      },
      { random: () => 0.3 },
    );
    expect(sequence.length).toBeGreaterThan(8);
    for (const id of sequence) {
      const eq = store.examinerQuestions.find(
        (row) => row.questionId === id && row.examinerId === 'ex_ahmed_peds' && row.caseId === 'case_nephrotic',
      );
      expect(eq).toBeTruthy();
    }
  });

  it('returns empty rather than inventing questions for an invalid pair', () => {
    const store = emptySeededStore();
    const sequence = selectQuestionSequence({
      departmentId: 'pediatrics',
      examinerId: 'ex_ahmed_peds',
      caseId: 'case_dka',
      examinerQuestions: store.examinerQuestions,
      questions: store.questions,
    });
    expect(sequence).toEqual([]);
  });
});
