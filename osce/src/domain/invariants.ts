import type { SpecialtyId } from './models';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function assertSpecialtyExaminer(
  specialtyId: SpecialtyId,
  examinerDepartmentId: SpecialtyId,
  examinerName: string,
): void {
  if (specialtyId !== examinerDepartmentId) {
    throw new DomainError(
      `Examiner ${examinerName} belongs to ${examinerDepartmentId}, not ${specialtyId}.`,
      'EXAMINER_SPECIALTY_MISMATCH',
    );
  }
}

export function assertExaminerCase(
  examinerId: string,
  caseId: string,
  associatedCaseIds: readonly string[],
): void {
  if (!associatedCaseIds.includes(caseId)) {
    throw new DomainError(
      `Case ${caseId} is not historically associated with examiner ${examinerId}.`,
      'CASE_NOT_ASSOCIATED_WITH_EXAMINER',
    );
  }
}

export function assertQuestionContext(
  questionId: string,
  allowedQuestionIds: readonly string[],
): void {
  if (!allowedQuestionIds.includes(questionId)) {
    throw new DomainError(
      `Question ${questionId} is not in this exam's examiner–case pool.`,
      'QUESTION_OUT_OF_CONTEXT',
    );
  }
}

export function assertPreparationDuration(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 30 || seconds > 60 * 30) {
    throw new DomainError(
      'Preparation duration must be between 30 seconds and 30 minutes.',
      'INVALID_PREPARATION_DURATION',
    );
  }
}
