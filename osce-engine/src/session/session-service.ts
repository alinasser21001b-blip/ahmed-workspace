/**
 * Exam session runtime (Section 8).
 *
 * The central property is that the *server* owns the station. Section 8 lists
 * why, and each reason is really a defence against a specific attack or bug:
 *
 *   - the browser cannot ask to evaluate an arbitrary unpublished question,
 *     because evaluation is addressed by `sessionQuestionId`, not by question
 *     text or question id;
 *   - ownership is verifiable before scoring, because the session row carries
 *     the student id;
 *   - refresh or resume cannot regenerate a different station, because the
 *     ordered questions were persisted at creation;
 *   - approved key points never leave the server before submission, because
 *     the public session view does not contain them.
 *
 * The phase machine is explicit for the same reason the review machine is:
 * a phase transition that "shouldn't happen" needs to be impossible, not
 * merely unlikely.
 */

import type {
  ExamSession,
  SessionId,
  SessionPhase,
  SessionQuestion,
  SessionQuestionId,
  StudentAnswer,
  StudentId,
} from '../domain/types.ts';
import { EngineError } from '../domain/errors.ts';
import type { Clock, IdFactory } from '../domain/ids.ts';
import type { CompiledStation } from '../station/compiler.ts';

const PHASE_TRANSITIONS: Readonly<Record<SessionPhase, readonly SessionPhase[]>> = Object.freeze({
  CREATED: ['PREPARATION', 'ABANDONED'],
  PREPARATION: ['QUESTIONING', 'ABANDONED'],
  QUESTIONING: ['COMPLETED', 'ABANDONED'],
  COMPLETED: [],
  ABANDONED: [],
});

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return (PHASE_TRANSITIONS[from] ?? []).includes(to);
}

export interface CreateSessionInput {
  readonly studentId: StudentId;
  readonly station: CompiledStation;
  readonly knowledgeVersion: string;
}

export interface CreatedSession {
  readonly session: ExamSession;
  readonly questions: readonly SessionQuestion[];
}

/**
 * Materializes a compiled station into a persistable session.
 *
 * Everything the runtime will ever need is frozen here: examiner, case, the
 * ordered question list, the preparation deadline as an absolute timestamp, and
 * the seed that produced it. Nothing downstream recomputes any of it.
 */
export function createSession(
  input: CreateSessionInput,
  deps: { ids: IdFactory; clock: Clock },
): CreatedSession {
  const now = deps.clock.now();
  const sessionId = deps.ids.session<SessionId>();

  const session: ExamSession = {
    id: sessionId,
    studentId: input.studentId,
    specialtyId: input.station.specialtyId,
    examinerId: input.station.examinerId,
    caseId: input.station.caseId,
    phase: 'CREATED',
    createdAt: now,
    // Absolute timestamp, not a duration. A duration would restart on every
    // page refresh and hand the student unlimited preparation time.
    preparationEndsAt: now + input.station.preparationSeconds * 1000,
    startedAt: null,
    completedAt: null,
    compilerSeed: input.station.seed,
    compilerPolicyVersion: input.station.policyVersion,
    knowledgeVersion: input.knowledgeVersion,
  };

  const questions: SessionQuestion[] = input.station.questions.map((q) => ({
    id: deps.ids.sessionQuestion<SessionQuestionId>(),
    sessionId,
    questionId: q.questionId,
    order: q.order,
    evaluationReady: q.evaluationReady,
    selectionReason: q.selectionReason,
  }));

  return { session, questions };
}

export function transition(session: ExamSession, to: SessionPhase, now: number): ExamSession {
  if (!canTransition(session.phase, to)) {
    throw new EngineError(
      'SESSION_NOT_ACTIVE',
      `Cannot move session from ${session.phase} to ${to}`,
      { sessionId: session.id, from: session.phase, to },
    );
  }
  return {
    ...session,
    phase: to,
    startedAt: to === 'QUESTIONING' ? (session.startedAt ?? now) : session.startedAt,
    completedAt: to === 'COMPLETED' || to === 'ABANDONED' ? now : session.completedAt,
  };
}

/**
 * Whether the student may begin answering.
 *
 * `allowEarlyStart` reflects Section 8's "early start optional": the student
 * may skip the remainder of preparation, but may never start before the session
 * exists. Server-side, so a client clock cannot grant extra time either way.
 */
export function canStartQuestioning(
  session: ExamSession,
  now: number,
  allowEarlyStart = true,
): boolean {
  if (session.phase === 'QUESTIONING') return true;
  if (session.phase !== 'PREPARATION') return false;
  return allowEarlyStart || now >= session.preparationEndsAt;
}

export interface SessionQuestionView {
  readonly sessionQuestionId: SessionQuestionId;
  readonly order: number;
  readonly questionText: string;
  /**
   * Whether automatic scoring is available for this question.
   *
   * Section 11's EvaluationReady contract: the client may know this, so it can
   * render self-scoring UI, but it must not receive the key points themselves
   * before submission.
   */
  readonly evaluationReady: boolean;
  readonly answered: boolean;
}

export interface PublicSessionView {
  readonly sessionId: SessionId;
  readonly phase: SessionPhase;
  readonly examinerName: string;
  readonly caseTitle: string;
  readonly preparationEndsAt: number;
  readonly serverTime: number;
  readonly questionCount: number;
  readonly currentQuestion: SessionQuestionView | null;
  readonly answeredCount: number;
}

/**
 * Builds the client-facing view.
 *
 * Deliberately a whitelist, not a redaction of the full row. A denylist leaks
 * the first field someone forgets to add to it; a whitelist leaks nothing by
 * default, which is the correct failure direction for a payload that contains
 * answer keys one field away.
 */
export function publicSessionView(
  session: ExamSession,
  questions: readonly SessionQuestion[],
  questionTexts: ReadonlyMap<string, string>,
  answers: readonly StudentAnswer[],
  examinerName: string,
  caseTitle: string,
  now: number,
): PublicSessionView {
  const answeredIds = new Set(answers.map((a) => a.sessionQuestionId as string));
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const current = ordered.find((q) => !answeredIds.has(q.id as string)) ?? null;

  return {
    sessionId: session.id,
    phase: session.phase,
    examinerName,
    caseTitle,
    preparationEndsAt: session.preparationEndsAt,
    // Sent so the client can compute a countdown against server time rather
    // than against a device clock that may be minutes off.
    serverTime: now,
    questionCount: ordered.length,
    currentQuestion:
      current === null
        ? null
        : {
            sessionQuestionId: current.id,
            order: current.order,
            questionText: questionTexts.get(current.questionId as string) ?? '',
            evaluationReady: current.evaluationReady,
            answered: false,
          },
    answeredCount: answeredIds.size,
  };
}

/**
 * Validates that a submission may be scored at all.
 *
 * Every check here is an authorization check, not a convenience check, and each
 * corresponds to a row in Section 11's risk table. Ordering matters: ownership
 * is verified before anything about the question is revealed, so a probe for
 * another student's session cannot be distinguished from a probe for a
 * nonexistent one.
 */
export function assertSubmittable(
  session: ExamSession | null,
  sessionQuestion: SessionQuestion | null,
  studentId: StudentId,
  existingAnswer: StudentAnswer | null,
): asserts session is ExamSession {
  if (session === null) {
    throw new EngineError('SESSION_NOT_FOUND', 'Session not found', {});
  }
  if (session.studentId !== studentId) {
    // Same code and message as "not found": revealing that a session exists but
    // belongs to someone else is itself a leak.
    throw new EngineError('SESSION_NOT_FOUND', 'Session not found', {});
  }
  if (session.phase !== 'QUESTIONING') {
    throw new EngineError('SESSION_NOT_ACTIVE', `Session is ${session.phase}`, {
      sessionId: session.id,
      phase: session.phase,
    });
  }
  if (sessionQuestion === null || sessionQuestion.sessionId !== session.id) {
    throw new EngineError(
      'SESSION_QUESTION_NOT_OWNED',
      'Question does not belong to this session',
      { sessionId: session.id },
    );
  }
  if (existingAnswer !== null) {
    throw new EngineError('ALREADY_ANSWERED', 'This question has already been answered', {
      sessionQuestionId: sessionQuestion.id,
    });
  }
}

export interface StationResult {
  readonly sessionId: SessionId;
  readonly totalQuestions: number;
  readonly answeredQuestions: number;
  readonly automaticScored: number;
  readonly selfScored: number;
  /** Mean score over answered questions, 0..1. Null when nothing was answered. */
  readonly meanScore: number | null;
  readonly correct: number;
  readonly partial: number;
  readonly incorrect: number;
  readonly durationMs: number | null;
}

/** Aggregates a finished station. Automatic and self scores are counted separately. */
export function summarize(
  session: ExamSession,
  questions: readonly SessionQuestion[],
  answers: readonly StudentAnswer[],
): StationResult {
  const scored = answers.filter((a) => a.score !== null);
  const meanScore =
    scored.length === 0
      ? null
      : scored.reduce((sum, a) => sum + (a.score as number), 0) / scored.length;

  return {
    sessionId: session.id,
    totalQuestions: questions.length,
    answeredQuestions: answers.length,
    automaticScored: answers.filter((a) => a.scoringMode === 'AUTOMATIC').length,
    selfScored: answers.filter((a) => a.scoringMode === 'SELF').length,
    meanScore: meanScore === null ? null : Math.round(meanScore * 10000) / 10000,
    correct: answers.filter((a) => a.correctness === 'CORRECT').length,
    partial: answers.filter((a) => a.correctness === 'PARTIAL').length,
    incorrect: answers.filter((a) => a.correctness === 'INCORRECT').length,
    durationMs:
      session.startedAt !== null && session.completedAt !== null
        ? session.completedAt - session.startedAt
        : null,
  };
}
