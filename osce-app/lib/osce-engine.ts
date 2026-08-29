/**
 * Domain contracts for the API layer. The prototype UI uses local fixtures,
 * but a production repository can implement these interfaces with D1/Drizzle
 * without coupling station delivery to a particular database or AI provider.
 */
export type ExamStatus = 'CREATED' | 'PREPARATION' | 'QUESTIONING' | 'COMPLETED';
export type ProcessingStatus = 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'REVIEW_REQUIRED' | 'FAILED';
export type Correctness = 'INCORRECT' | 'PARTIAL' | 'CORRECT';

export interface ExamSession {
  id: string; studentId?: string; specialtyId: string; examinerId: string; caseId: string;
  preparationDuration: number; startedAt: Date; status: ExamStatus; questionSequence: string[];
  answers: StudentAnswer[];
}
export interface StudentAnswer { questionId: string; text: string; correctness: Correctness; score: number; }
export interface KnowledgeDocument { id: string; filename: string; fileType: 'PDF'|'DOCX'|'TXT'|'MARKDOWN'; uploadedAt: Date; processingStatus: ProcessingStatus; departmentId?: string; sourceYear?: number; processedAt?: Date; version: number; }
export interface QuestionOccurrence { examinerId: string; questionId: string; year?: number; sourceDocumentId: string; sourceText: string; confidence: number; }
export interface EvaluationResult { score: number; correctness: Correctness; coveredPoints: string[]; missingPoints: string[]; feedback: string; confidence: number; }

/** Uses the curated expected answer as authority; an LLM adapter may interpret, never invent. */
export interface EvaluationService { evaluate(input: { question: string; expectedAnswer: string; studentAnswer: string }): Promise<EvaluationResult>; }
/** Keeps ingestion provenance and uncertain extraction out of the live exam pool. */
export interface KnowledgeExtractionService { extract(document: KnowledgeDocument): Promise<{ occurrences: QuestionOccurrence[]; requiresReview: boolean }>; }
/** Must only return questions linked to the selected examiner and their associated case. */
export interface QuestionSelectionEngine { select(input: { specialtyId: string; examinerId: string; caseId: string; questionIds: string[] }): string[]; }
