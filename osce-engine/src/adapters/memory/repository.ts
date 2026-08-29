/**
 * In-memory repository.
 *
 * Exists so the entire engine can be exercised - ingestion through evaluation -
 * with no database, which is what makes the acceptance suite in `test/` run in
 * milliseconds and in CI without a service container.
 *
 * It is a real implementation of the ports, not a stub: it enforces the same
 * uniqueness constraints the SQL schema does, because a fake that accepts
 * writes the real store would reject tests nothing useful.
 */

import type {
  CaseId,
  ClinicalCase,
  ExaminerId,
  Examiner,
  ExpectedAnswer,
  ExtractionCandidate,
  Question,
  QuestionId,
  QuestionOccurrence,
  SourceReference,
  SpecialtyId,
} from '../../domain/types.ts';
import { EngineError } from '../../domain/errors.ts';
import type {
  CompilerCase,
  CompilerExaminer,
  CompilerQuestion,
  KnowledgeSource,
} from '../../station/compiler.ts';
import { isEvaluationReady } from '../../publish/publisher.ts';

export class MemoryStore implements KnowledgeSource {
  readonly examiners = new Map<string, Examiner>();
  readonly cases = new Map<string, ClinicalCase>();
  readonly questions = new Map<string, Question>();
  readonly occurrences = new Map<string, QuestionOccurrence>();
  readonly answers = new Map<string, ExpectedAnswer>();
  readonly candidates = new Map<string, ExtractionCandidate>();
  readonly sourceReferences = new Map<string, SourceReference>();

  /** examinerId|caseId -> published */
  readonly examinerCasePublished = new Set<string>();
  /** examinerId|caseId|questionId -> published */
  readonly examinerQuestionPublished = new Set<string>();

  // --- Writes ---------------------------------------------------------------

  putExaminer(examiner: Examiner): void {
    // Mirrors UNIQUE (specialty_id, normalized_name).
    for (const existing of this.examiners.values()) {
      if (existing.id === examiner.id) continue;
      if (
        existing.specialtyId === examiner.specialtyId &&
        existing.canonicalName.toLowerCase() === examiner.canonicalName.toLowerCase()
      ) {
        throw new EngineError(
          'PUBLISH_CONFLICT',
          'An examiner with this name already exists in this specialty',
          { specialtyId: examiner.specialtyId, canonicalName: examiner.canonicalName },
        );
      }
    }
    this.examiners.set(examiner.id as string, examiner);
  }

  putCase(clinicalCase: ClinicalCase): void {
    this.cases.set(clinicalCase.id as string, clinicalCase);
  }

  putQuestion(question: Question): void {
    this.questions.set(question.id as string, question);
  }

  putAnswer(answer: ExpectedAnswer): void {
    if (answer.approved) {
      for (const existing of this.answers.values()) {
        if (existing.id === answer.id) continue;
        if (existing.questionId === answer.questionId && existing.approved) {
          throw new EngineError(
            'PUBLISH_CONFLICT',
            'An approved answer already exists for this question',
            { questionId: answer.questionId },
          );
        }
      }
    }
    this.answers.set(answer.id as string, answer);
  }

  /**
   * Inserts an occurrence unless its fingerprint is already present.
   *
   * Returns false on a duplicate rather than throwing: replaying a publication
   * is a normal, expected operation, and the caller counts skips.
   */
  putOccurrence(occurrence: QuestionOccurrence): boolean {
    for (const existing of this.occurrences.values()) {
      if (existing.fingerprint === occurrence.fingerprint) return false;
    }
    this.occurrences.set(occurrence.id as string, occurrence);
    return true;
  }

  publishLink(examinerId: ExaminerId, caseId: CaseId, questionId?: QuestionId): void {
    this.examinerCasePublished.add(`${examinerId}|${caseId}`);
    if (questionId !== undefined) {
      this.examinerQuestionPublished.add(`${examinerId}|${caseId}|${questionId}`);
    }
  }

  // --- Derived counts (never incremented) -----------------------------------

  countFor(examinerId: ExaminerId, caseId?: CaseId, questionId?: QuestionId): number {
    let count = 0;
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.examinerId !== examinerId) continue;
      if (caseId !== undefined && occurrence.caseId !== caseId) continue;
      if (questionId !== undefined && occurrence.questionId !== questionId) continue;
      count++;
    }
    return count;
  }

  lastYearFor(examinerId: ExaminerId, caseId: CaseId, questionId?: QuestionId): number | null {
    let last: number | null = null;
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.examinerId !== examinerId || occurrence.caseId !== caseId) continue;
      if (questionId !== undefined && occurrence.questionId !== questionId) continue;
      if (occurrence.academicYear === null) continue;
      if (last === null || occurrence.academicYear > last) last = occurrence.academicYear;
    }
    return last;
  }

  approvedAnswerFor(questionId: QuestionId): ExpectedAnswer | null {
    for (const answer of this.answers.values()) {
      if (answer.questionId === questionId && answer.approved) return answer;
    }
    return null;
  }

  // --- KnowledgeSource (the exam-path read port) ----------------------------

  listPublishedExaminers(specialtyId: SpecialtyId): CompilerExaminer[] {
    const out: CompilerExaminer[] = [];
    for (const examiner of this.examiners.values()) {
      if (examiner.specialtyId !== specialtyId || !examiner.active) continue;
      // An examiner with no published case cannot produce a station, so it is
      // not "published" from the compiler's point of view.
      const hasPublishedCase = [...this.examinerCasePublished].some((key) =>
        key.startsWith(`${examiner.id}|`),
      );
      if (!hasPublishedCase) continue;
      out.push({
        id: examiner.id,
        specialtyId: examiner.specialtyId,
        canonicalName: examiner.canonicalName,
        observationCount: this.countFor(examiner.id),
      });
    }
    return out;
  }

  listPublishedCasesForExaminer(examinerId: ExaminerId): CompilerCase[] {
    const out: CompilerCase[] = [];
    for (const key of this.examinerCasePublished) {
      const [linkExaminerId, caseId] = key.split('|') as [string, string];
      if (linkExaminerId !== (examinerId as string)) continue;
      const clinicalCase = this.cases.get(caseId);
      if (clinicalCase === undefined || !clinicalCase.active) continue;
      out.push({
        id: clinicalCase.id,
        examinerId,
        title: clinicalCase.title,
        observationCount: this.countFor(examinerId, clinicalCase.id),
        lastSeenYear: this.lastYearFor(examinerId, clinicalCase.id),
      });
    }
    // Stable order so that a seeded compilation is reproducible across runs;
    // Set iteration order is insertion order, which a replay may not reproduce.
    return out.sort((a, b) => (a.id as string).localeCompare(b.id as string));
  }

  listPublishedQuestions(examinerId: ExaminerId, caseId: CaseId): CompilerQuestion[] {
    const out: CompilerQuestion[] = [];
    for (const key of this.examinerQuestionPublished) {
      const [linkExaminerId, linkCaseId, questionId] = key.split('|') as [string, string, string];
      if (linkExaminerId !== (examinerId as string) || linkCaseId !== (caseId as string)) continue;
      const question = this.questions.get(questionId);
      if (question === undefined) continue;
      out.push({
        id: question.id,
        examinerId,
        caseId,
        canonicalText: question.canonicalText,
        category: question.category,
        observationCount: this.countFor(examinerId, caseId, question.id),
        lastSeenYear: this.lastYearFor(examinerId, caseId, question.id),
        evaluationReady: isEvaluationReady(this.approvedAnswerFor(question.id)),
      });
    }
    return out.sort((a, b) => (a.id as string).localeCompare(b.id as string));
  }
}
