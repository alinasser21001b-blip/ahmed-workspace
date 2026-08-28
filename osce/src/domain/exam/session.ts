import type {
  CaseMode,
  CreateExamRequest,
  ExamSession,
  Examiner,
  ExaminerMode,
  ExaminerQuestion,
  ClinicalCase,
  Question,
  SpecialtyId,
  StudentAnswer,
} from '../models';
import { isSpecialtyId } from '../models';
import {
  assertExaminerCase,
  assertPreparationDuration,
  assertQuestionContext,
  assertSpecialtyExaminer,
  DomainError,
} from '../invariants';
import { selectQuestionSequence } from '../question-selection/engine';
import { computeExamScores } from './scoring';
import { createId, nowIso, pickRandom, remainingSeconds } from '../../lib/ids';

export interface ExamClock {
  now: () => Date;
  random: () => number;
}

const defaultClock: ExamClock = {
  now: () => new Date(),
  random: Math.random,
};

export interface KnowledgeView {
  examiners: readonly Examiner[];
  cases: readonly ClinicalCase[];
  questions: readonly Question[];
  examinerQuestions: readonly ExaminerQuestion[];
}

export function activeExaminersForSpecialty(
  knowledge: KnowledgeView,
  specialtyId: SpecialtyId,
): Examiner[] {
  return knowledge.examiners.filter((examiner) => examiner.departmentId === specialtyId && examiner.active);
}

export function caseIdsForExaminer(knowledge: KnowledgeView, examinerId: string): string[] {
  return [
    ...new Set(
      knowledge.examinerQuestions.filter((eq) => eq.examinerId === examinerId).map((eq) => eq.caseId),
    ),
  ];
}

export function questionIdsForExaminerCase(
  knowledge: KnowledgeView,
  examinerId: string,
  caseId: string,
): string[] {
  return [
    ...new Set(
      knowledge.examinerQuestions
        .filter((eq) => eq.examinerId === examinerId && eq.caseId === caseId)
        .map((eq) => eq.questionId),
    ),
  ];
}

export function resolveExaminer(
  knowledge: KnowledgeView,
  specialtyId: SpecialtyId,
  mode: ExaminerMode,
  examinerId: string | null | undefined,
  random: () => number,
): Examiner {
  const pool = activeExaminersForSpecialty(knowledge, specialtyId).filter(
    (examiner) => caseIdsForExaminer(knowledge, examiner.id).length > 0,
  );
  if (pool.length === 0) {
    throw new DomainError(`No examiners with cases in specialty ${specialtyId}.`, 'NO_EXAMINERS');
  }

  if (mode === 'RANDOM') {
    return pickRandom(pool, random);
  }

  if (!examinerId) {
    throw new DomainError('examinerId is required when examinerMode is SELECTED.', 'EXAMINER_REQUIRED');
  }
  const examiner = knowledge.examiners.find((row) => row.id === examinerId);
  if (!examiner) {
    throw new DomainError('Examiner not found.', 'EXAMINER_NOT_FOUND', 404);
  }
  assertSpecialtyExaminer(specialtyId, examiner.departmentId, examiner.name);
  if (!examiner.active) {
    throw new DomainError('Examiner is not active.', 'EXAMINER_INACTIVE');
  }
  return examiner;
}

export function resolveCase(
  knowledge: KnowledgeView,
  examiner: Examiner,
  mode: CaseMode,
  caseId: string | null | undefined,
  random: () => number,
): ClinicalCase {
  const associated = caseIdsForExaminer(knowledge, examiner.id);
  if (associated.length === 0) {
    throw new DomainError(`Examiner ${examiner.name} has no associated cases.`, 'NO_CASES_FOR_EXAMINER');
  }

  if (mode === 'SELECTED') {
    if (!caseId) {
      throw new DomainError('caseId is required when caseMode is SELECTED.', 'CASE_REQUIRED');
    }
    assertExaminerCase(examiner.id, caseId, associated);
    const selected = knowledge.cases.find((row) => row.id === caseId);
    if (!selected) throw new DomainError('Case not found.', 'CASE_NOT_FOUND', 404);
    if (selected.departmentId !== examiner.departmentId) {
      throw new DomainError('Case specialty does not match examiner specialty.', 'CASE_SPECIALTY_MISMATCH');
    }
    return selected;
  }

  const chosenId = pickRandom(associated, random);
  const chosen = knowledge.cases.find((row) => row.id === chosenId);
  if (!chosen) throw new DomainError('Associated case is missing from the knowledge base.', 'CASE_NOT_FOUND', 500);
  if (chosen.departmentId !== examiner.departmentId) {
    throw new DomainError('Case specialty does not match examiner specialty.', 'CASE_SPECIALTY_MISMATCH');
  }
  return chosen;
}

export function createExamSession(
  request: CreateExamRequest,
  knowledge: KnowledgeView,
  clock: ExamClock = defaultClock,
): ExamSession {
  if (!isSpecialtyId(request.specialtyId)) {
    throw new DomainError('Unknown specialty.', 'UNKNOWN_SPECIALTY');
  }
  assertPreparationDuration(request.preparationDuration);

  const examiner = resolveExaminer(
    knowledge,
    request.specialtyId,
    request.examinerMode,
    request.examinerId,
    clock.random,
  );
  const caseMode: CaseMode = request.caseMode ?? 'RANDOM';
  const clinicalCase = resolveCase(knowledge, examiner, caseMode, request.caseId, clock.random);

  const sequence = selectQuestionSequence(
    {
      departmentId: request.specialtyId,
      examinerId: examiner.id,
      caseId: clinicalCase.id,
      examinerQuestions: knowledge.examinerQuestions,
      questions: knowledge.questions,
    },
    { random: clock.random },
  );

  if (sequence.length === 0) {
    throw new DomainError(
      'No questions in this examiner–case pool. The exam cannot start.',
      'EMPTY_QUESTION_POOL',
    );
  }

  for (const questionId of sequence) {
    assertQuestionContext(questionId, questionIdsForExaminerCase(knowledge, examiner.id, clinicalCase.id));
  }

  return {
    id: createId('exam'),
    studentId: request.studentId,
    specialtyId: request.specialtyId,
    examinerId: examiner.id,
    caseId: clinicalCase.id,
    examinerMode: request.examinerMode,
    caseMode,
    preparationDuration: request.preparationDuration,
    startedAt: null,
    preparationEndsAt: null,
    questioningStartedAt: null,
    completedAt: null,
    status: 'CREATED',
    questionSequence: sequence,
    currentQuestionIndex: 0,
    answers: [],
    scores: null,
    createdAt: nowIso(clock.now),
  };
}

export function startPreparation(session: ExamSession, clock: ExamClock = defaultClock): ExamSession {
  if (session.status !== 'CREATED' && session.status !== 'PREPARATION') {
    throw new DomainError(`Cannot start preparation from status ${session.status}.`, 'INVALID_STATUS');
  }
  if (session.status === 'PREPARATION' && session.preparationEndsAt) {
    return session;
  }
  const startedAt = clock.now();
  const ends = new Date(startedAt.getTime() + session.preparationDuration * 1000);
  return {
    ...session,
    status: 'PREPARATION',
    startedAt: startedAt.toISOString(),
    preparationEndsAt: ends.toISOString(),
  };
}

export function beginQuestioning(session: ExamSession, clock: ExamClock = defaultClock): ExamSession {
  if (session.status === 'QUESTIONING') return session;
  if (session.status !== 'PREPARATION' && session.status !== 'CREATED') {
    throw new DomainError(`Cannot enter questioning from ${session.status}.`, 'INVALID_STATUS');
  }
  const started = session.startedAt ? session : startPreparation(session, clock);
  return {
    ...started,
    status: 'QUESTIONING',
    questioningStartedAt: nowIso(clock.now),
  };
}

export function maybeAdvanceTimer(session: ExamSession, nowMs = Date.now()): ExamSession {
  if (session.status !== 'PREPARATION' || !session.preparationEndsAt) return session;
  if (remainingSeconds(session.preparationEndsAt, nowMs) > 0) return session;
  return beginQuestioning(session, { now: () => new Date(nowMs), random: Math.random });
}

export function recordAnswer(
  session: ExamSession,
  answer: StudentAnswer,
  knowledge: KnowledgeView,
): ExamSession {
  if (session.status !== 'QUESTIONING') {
    throw new DomainError('Answers are only accepted during questioning.', 'INVALID_STATUS');
  }
  const currentId = session.questionSequence[session.currentQuestionIndex];
  if (!currentId || currentId !== answer.questionId) {
    throw new DomainError('Answer does not match the current question.', 'QUESTION_MISMATCH');
  }
  assertQuestionContext(
    answer.questionId,
    questionIdsForExaminerCase(knowledge, session.examinerId, session.caseId),
  );

  const answers = session.answers.filter((row) => row.questionId !== answer.questionId).concat(answer);
  return { ...session, answers };
}

export function advanceQuestion(session: ExamSession): ExamSession {
  if (session.status !== 'QUESTIONING') {
    throw new DomainError('Cannot advance outside questioning.', 'INVALID_STATUS');
  }
  const currentId = session.questionSequence[session.currentQuestionIndex];
  if (!currentId) {
    throw new DomainError('No current question.', 'NO_CURRENT_QUESTION');
  }
  const answered = session.answers.some((row) => row.questionId === currentId);
  if (!answered) {
    throw new DomainError('Evaluate the current question before continuing.', 'ANSWER_REQUIRED');
  }
  const next = session.currentQuestionIndex + 1;
  if (next >= session.questionSequence.length) {
    return session;
  }
  return { ...session, currentQuestionIndex: next };
}

export function completeExam(
  session: ExamSession,
  knowledge: KnowledgeView,
  clock: ExamClock = defaultClock,
): ExamSession {
  if (session.status === 'COMPLETED') return session;
  if (session.status !== 'QUESTIONING') {
    throw new DomainError('Exam can only be completed from questioning.', 'INVALID_STATUS');
  }
  const scores = computeExamScores(session.questionSequence, session.answers, knowledge.questions);
  return {
    ...session,
    status: 'COMPLETED',
    completedAt: nowIso(clock.now),
    scores,
  };
}

export function isLastQuestion(session: ExamSession): boolean {
  return session.currentQuestionIndex >= session.questionSequence.length - 1;
}
