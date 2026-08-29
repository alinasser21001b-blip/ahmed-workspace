/**
 * Canonical domain model.
 *
 * Implements Section 3 of the OSCE Knowledge-to-Station Engineering Framework,
 * with the V2 additions required to make the engine auditable:
 *   - every published fact carries a `SourceReferenceId` chain back to an
 *     immutable upload;
 *   - every derived count is recomputed from approved occurrences only;
 *   - every runtime artefact (session, question order) is frozen at creation.
 *
 * Branded ID types make it a compile-time error to pass an ExaminerId where a
 * CaseId is expected. This class of bug is otherwise invisible in a codebase
 * where every identifier is a string.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DocumentId = Brand<string, 'DocumentId'>;
export type ExtractionRunId = Brand<string, 'ExtractionRunId'>;
export type SourceReferenceId = Brand<string, 'SourceReferenceId'>;
export type SpecialtyId = Brand<string, 'SpecialtyId'>;
export type ExaminerId = Brand<string, 'ExaminerId'>;
export type CaseId = Brand<string, 'CaseId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type VariantId = Brand<string, 'VariantId'>;
export type OccurrenceId = Brand<string, 'OccurrenceId'>;
export type CandidateId = Brand<string, 'CandidateId'>;
export type AnswerKeyId = Brand<string, 'AnswerKeyId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type SessionQuestionId = Brand<string, 'SessionQuestionId'>;
export type StudentId = Brand<string, 'StudentId'>;

/** Unsafe cast used only at repository/adapter boundaries where the DB is the authority. */
export const asId = <T extends string>(raw: string): T => raw as T;

// ---------------------------------------------------------------------------
// Knowledge path
// ---------------------------------------------------------------------------

export type DocumentStatus =
  | 'RECEIVED'
  | 'EXTRACTING'
  | 'REVIEW_REQUIRED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'OCR_REQUIRED';

export type SourceFormat = 'txt' | 'md' | 'docx' | 'pdf';

export interface KnowledgeDocument {
  readonly id: DocumentId;
  readonly filename: string;
  readonly format: SourceFormat;
  readonly byteSize: number;
  /** Content hash of the stored object. Drives upload idempotency (§4.1). */
  readonly contentHash: string;
  /** Server-generated object key. The original filename is metadata only. */
  readonly objectKey: string;
  readonly academicYear: number | null;
  readonly specialtyId: SpecialtyId | null;
  readonly status: DocumentStatus;
  readonly uploadedAt: number;
  readonly uploadedBy: string;
}

/**
 * A versioned processing attempt. Re-running extraction never mutates a prior
 * run; it creates a new one. This is what makes parser improvements safe:
 * published knowledge stays pinned to the run that produced it until a
 * reviewer explicitly reconciles.
 */
export interface ExtractionRun {
  readonly id: ExtractionRunId;
  readonly documentId: DocumentId;
  readonly extractorVersion: string;
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'OCR_REQUIRED';
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly candidateCount: number;
  readonly failureCode: string | null;
  /** Set when this run supersedes an earlier run for the same document. */
  readonly supersedesRunId: ExtractionRunId | null;
}

/** Evidence pointer. Every candidate and every occurrence must have one. */
export interface SourceReference {
  readonly id: SourceReferenceId;
  readonly documentId: DocumentId;
  readonly extractionRunId: ExtractionRunId;
  readonly page: number | null;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly charStart: number;
  readonly charEnd: number;
  /** Verbatim excerpt. Never normalized — this is the audit artefact. */
  readonly excerpt: string;
}

export interface Specialty {
  readonly id: SpecialtyId;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly active: boolean;
}

export interface Examiner {
  readonly id: ExaminerId;
  readonly specialtyId: SpecialtyId;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly active: boolean;
  readonly createdAt: number;
}

export interface ClinicalCase {
  readonly id: CaseId;
  readonly specialtyId: SpecialtyId;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly active: boolean;
}

export type QuestionCategory =
  | 'HISTORY'
  | 'EXAMINATION'
  | 'INVESTIGATION'
  | 'DIAGNOSIS'
  | 'MANAGEMENT'
  | 'COMPLICATION'
  | 'ANATOMY'
  | 'PHARMACOLOGY'
  | 'COUNSELLING'
  | 'UNCLASSIFIED';

export interface Question {
  readonly id: QuestionId;
  readonly canonicalText: string;
  /** Normalized form used for exact dedup. Derived, never authored. */
  readonly normalizedText: string;
  readonly category: QuestionCategory;
  readonly createdAt: number;
}

/** An observed wording of a canonical question. Preserves what students recalled. */
export interface QuestionVariant {
  readonly id: VariantId;
  readonly questionId: QuestionId;
  readonly observedText: string;
  readonly sourceReferenceId: SourceReferenceId;
  readonly language: 'ar' | 'en' | 'mixed';
}

/**
 * A historical evidence event: "this examiner asked this question in this case
 * in this year, and here is the file that says so."
 * The unique fingerprint is what makes re-publishing idempotent (§11).
 */
export interface QuestionOccurrence {
  readonly id: OccurrenceId;
  readonly examinerId: ExaminerId;
  readonly caseId: CaseId;
  readonly questionId: QuestionId;
  readonly academicYear: number | null;
  readonly sourceReferenceId: SourceReferenceId;
  /** Stable hash over (examiner, case, question, year, documentId, charStart). */
  readonly fingerprint: string;
  readonly publishedAt: number;
}

export type AnswerSourceType = 'SOURCE_RECALL' | 'REVIEWER_CURATED' | 'TEXTBOOK_REFERENCED';

/** A scoring anchor. Weight lets a reviewer mark a point as required vs. bonus. */
export interface KeyPoint {
  readonly id: string;
  readonly text: string;
  /** Accepted alternatives supplied by the reviewer, on top of lexicon expansion. */
  readonly synonyms: readonly string[];
  /** 1.0 = required for a fully correct answer. 0 = bonus, never penalised. */
  readonly weight: number;
  /**
   * When true, mentioning this point NEGATES the answer (a classic OSCE
   * "never say this" trap). Scored as a penalty, not as coverage.
   */
  readonly isPitfall: boolean;
}

export interface ExpectedAnswer {
  readonly id: AnswerKeyId;
  readonly questionId: QuestionId;
  readonly canonicalAnswer: string;
  readonly keyPoints: readonly KeyPoint[];
  readonly sourceType: AnswerSourceType;
  readonly approved: boolean;
  readonly approvedBy: string | null;
  readonly approvedAt: number | null;
  readonly sourceReferenceId: SourceReferenceId | null;
}

/** Validated association, with counts derived from approved occurrences only. */
export interface ExaminerCase {
  readonly examinerId: ExaminerId;
  readonly caseId: CaseId;
  readonly observationCount: number;
  readonly firstSeenYear: number | null;
  readonly lastSeenYear: number | null;
  readonly published: boolean;
}

export interface ExaminerQuestion {
  readonly examinerId: ExaminerId;
  readonly caseId: CaseId;
  readonly questionId: QuestionId;
  readonly observationCount: number;
  readonly lastSeenYear: number | null;
  readonly published: boolean;
}

// ---------------------------------------------------------------------------
// Review path
// ---------------------------------------------------------------------------

export type CandidateState =
  | 'PENDING'
  | 'APPROVED'
  | 'EDITED'
  | 'REJECTED'
  | 'MERGED'
  | 'PUBLISHED';

export type CandidateType = 'EXAMINER' | 'CASE' | 'QUESTION' | 'ANSWER';

export interface ExtractionCandidate {
  readonly id: CandidateId;
  readonly documentId: DocumentId;
  readonly extractionRunId: ExtractionRunId;
  readonly type: CandidateType;
  readonly state: CandidateState;
  /** Raw text exactly as segmented from the source. */
  readonly rawText: string;
  /** Engine's normalized proposal. Reviewer may overwrite via `editedText`. */
  readonly proposedText: string;
  readonly editedText: string | null;
  readonly sourceReferenceId: SourceReferenceId;
  /** 0..1. Never used to auto-approve — only to order the review queue. */
  readonly confidence: number;
  /** Grouping key linking an examiner/case/question/answer set from one segment. */
  readonly segmentKey: string;
  readonly specialtyId: SpecialtyId | null;
  readonly academicYear: number | null;
  readonly category: QuestionCategory | null;
  /** Set when state === 'MERGED'. */
  readonly mergedIntoCandidateId: CandidateId | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: number | null;
  readonly reviewNote: string | null;
}

// ---------------------------------------------------------------------------
// Exam path
// ---------------------------------------------------------------------------

export type SessionPhase = 'CREATED' | 'PREPARATION' | 'QUESTIONING' | 'COMPLETED' | 'ABANDONED';

export interface ExamSession {
  readonly id: SessionId;
  readonly studentId: StudentId;
  readonly specialtyId: SpecialtyId;
  readonly examinerId: ExaminerId;
  readonly caseId: CaseId;
  readonly phase: SessionPhase;
  readonly createdAt: number;
  readonly preparationEndsAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  /** Seed that produced this station. Replaying it reproduces the exact station. */
  readonly compilerSeed: string;
  readonly compilerPolicyVersion: string;
  /** Snapshot marker: which knowledge generation this station was compiled from. */
  readonly knowledgeVersion: string;
}

export interface SessionQuestion {
  readonly id: SessionQuestionId;
  readonly sessionId: SessionId;
  readonly questionId: QuestionId;
  readonly order: number;
  /** True only when an approved ExpectedAnswer with key points exists. */
  readonly evaluationReady: boolean;
  /** Why the compiler picked this question. Debuggability requirement (§7). */
  readonly selectionReason: SelectionReason;
}

export interface SelectionReason {
  readonly score: number;
  readonly historicalFrequency: number;
  readonly caseRelevance: number;
  readonly recencySignal: number;
  readonly diversityBonus: number;
  readonly randomness: number;
  readonly rank: number;
  readonly poolSize: number;
}

export type ScoringMode = 'AUTOMATIC' | 'SELF';
export type Correctness = 'CORRECT' | 'PARTIAL' | 'INCORRECT';

export interface StudentAnswer {
  readonly sessionQuestionId: SessionQuestionId;
  readonly answerText: string;
  readonly scoringMode: ScoringMode;
  readonly correctness: Correctness | null;
  readonly score: number | null;
  readonly coveredPointIds: readonly string[];
  readonly missingPointIds: readonly string[];
  readonly triggeredPitfallIds: readonly string[];
  readonly evaluatorVersion: string | null;
  readonly submittedAt: number;
  readonly latencyMs: number | null;
}
