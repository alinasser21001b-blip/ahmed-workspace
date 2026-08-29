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

  /**
   * Count and last-year indexes over the occurrence table.
   *
   * These mirror the `observation_count` / `last_seen_year` columns the SQL
   * schema caches on the link tables. Without them every count is a full scan
   * of the occurrence table, which turns one station compilation over a
   * realistic corpus into millions of comparisons - the in-memory adapter would
   * then dominate any benchmark and hide the engine's real cost.
   *
   * They stay honest because occurrences are the only writer and are never
   * deleted here, and because `recount` re-derives the same numbers by scan, so
   * a test can assert the index has not drifted - the same relationship the
   * schema's `v_examiner_case_counts` view has to its cached column.
   */
  private readonly countIndex = new Map<string, number>();
  private readonly lastYearIndex = new Map<string, number>();
  /** Mirrors the UNIQUE index on question_occurrence(fingerprint). */
  private readonly fingerprints = new Set<string>();

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
    if (this.fingerprints.has(occurrence.fingerprint)) return false;
    this.fingerprints.add(occurrence.fingerprint);
    this.occurrences.set(occurrence.id as string, occurrence);

    // Maintain the three aggregation levels the compiler reads.
    const { examinerId, caseId, questionId, academicYear } = occurrence;
    for (const key of [
      `${examinerId}`,
      `${examinerId}|${caseId}`,
      `${examinerId}|${caseId}|${questionId}`,
    ]) {
      this.countIndex.set(key, (this.countIndex.get(key) ?? 0) + 1);
      if (academicYear !== null) {
        const current = this.lastYearIndex.get(key);
        if (current === undefined || academicYear > current) {
          this.lastYearIndex.set(key, academicYear);
        }
      }
    }
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
    return this.countIndex.get(aggregationKey(examinerId, caseId, questionId)) ?? 0;
  }

  lastYearFor(examinerId: ExaminerId, caseId: CaseId, questionId?: QuestionId): number | null {
    return this.lastYearIndex.get(aggregationKey(examinerId, caseId, questionId)) ?? null;
  }

  /**
   * Recomputes a count by scanning the occurrence table.
   *
   * The authority behind `countFor`, exactly as `v_examiner_case_counts` is the
   * authority behind the cached column in SQL. A test asserts the two agree, so
   * index drift becomes a test failure rather than a silently wrong
   * "asked 5 times" on a student's screen.
   */
  recount(examinerId: ExaminerId, caseId?: CaseId, questionId?: QuestionId): number {
    let count = 0;
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.examinerId !== examinerId) continue;
      if (caseId !== undefined && occurrence.caseId !== caseId) continue;
      if (questionId !== undefined && occurrence.questionId !== questionId) continue;
      count++;
    }
    return count;
  }

  /** True when every cached count matches a fresh recount. */
  verifyCounts(): boolean {
    const expected = new Map<string, number>();
    for (const occurrence of this.occurrences.values()) {
      const { examinerId, caseId, questionId } = occurrence;
      for (const key of [
        `${examinerId}`,
        `${examinerId}|${caseId}`,
        `${examinerId}|${caseId}|${questionId}`,
      ]) {
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
    }
    if (expected.size !== this.countIndex.size) return false;
    for (const [key, count] of expected) {
      if (this.countIndex.get(key) !== count) return false;
    }
    return true;
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
    // Group the published links once rather than re-scanning the set per
    // examiner: the naive form is O(examiners x links) on the exam-start path.
    const casesByExaminer = this.publishedCasesByExaminer();
    for (const examiner of this.examiners.values()) {
      if (examiner.specialtyId !== specialtyId || !examiner.active) continue;
      // An examiner with no published case cannot produce a station, so it is
      // not "published" from the compiler's point of view.
      if ((casesByExaminer.get(examiner.id as string)?.length ?? 0) === 0) continue;
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
    for (const caseId of this.publishedCasesByExaminer().get(examinerId as string) ?? []) {
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
    for (const questionId of this.publishedQuestionsByPair().get(`${examinerId}|${caseId}`) ?? []) {
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

  // --- Link grouping, rebuilt when the link sets change ---------------------

  private casesByExaminerCache: Map<string, string[]> | null = null;
  private casesByExaminerSize = -1;
  private questionsByPairCache: Map<string, string[]> | null = null;
  private questionsByPairSize = -1;

  private publishedCasesByExaminer(): Map<string, string[]> {
    if (
      this.casesByExaminerCache !== null &&
      this.casesByExaminerSize === this.examinerCasePublished.size
    ) {
      return this.casesByExaminerCache;
    }
    const grouped = new Map<string, string[]>();
    for (const key of this.examinerCasePublished) {
      const [examinerId, caseId] = key.split('|') as [string, string];
      const bucket = grouped.get(examinerId);
      if (bucket === undefined) grouped.set(examinerId, [caseId]);
      else bucket.push(caseId);
    }
    this.casesByExaminerCache = grouped;
    this.casesByExaminerSize = this.examinerCasePublished.size;
    return grouped;
  }

  private publishedQuestionsByPair(): Map<string, string[]> {
    if (
      this.questionsByPairCache !== null &&
      this.questionsByPairSize === this.examinerQuestionPublished.size
    ) {
      return this.questionsByPairCache;
    }
    const grouped = new Map<string, string[]>();
    for (const key of this.examinerQuestionPublished) {
      const [examinerId, caseId, questionId] = key.split('|') as [string, string, string];
      const pair = `${examinerId}|${caseId}`;
      const bucket = grouped.get(pair);
      if (bucket === undefined) grouped.set(pair, [questionId]);
      else bucket.push(questionId);
    }
    this.questionsByPairCache = grouped;
    this.questionsByPairSize = this.examinerQuestionPublished.size;
    return grouped;
  }
}

function aggregationKey(examinerId: ExaminerId, caseId?: CaseId, questionId?: QuestionId): string {
  if (caseId === undefined) return `${examinerId}`;
  if (questionId === undefined) return `${examinerId}|${caseId}`;
  return `${examinerId}|${caseId}|${questionId}`;
}
