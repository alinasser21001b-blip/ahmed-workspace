/**
 * OSCE domain models.
 *
 * The core intellectual asset is historical examiner knowledge:
 * which examiner asks which questions about which cases, and how often.
 * AI is never the source of medical truth — curated records are.
 */

export const SPECIALTY_IDS = [
  'internal-medicine',
  'pediatrics',
  'surgery',
  'minor-specialties',
  'obstetrics-gynecology',
] as const;

export type SpecialtyId = (typeof SPECIALTY_IDS)[number];

export const EXAM_STATUSES = [
  'CREATED',
  'PREPARATION',
  'QUESTIONING',
  'COMPLETED',
] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const EXAMINER_MODES = ['RANDOM', 'SELECTED'] as const;
export type ExaminerMode = (typeof EXAMINER_MODES)[number];

export const CASE_MODES = ['RANDOM', 'SELECTED'] as const;
export type CaseMode = (typeof CASE_MODES)[number];

export const CORRECTNESS_VALUES = ['INCORRECT', 'PARTIAL', 'CORRECT'] as const;
export type Correctness = (typeof CORRECTNESS_VALUES)[number];

export const DOCUMENT_STATUSES = [
  'UPLOADED',
  'PROCESSING',
  'PROCESSED',
  'REVIEW_REQUIRED',
  'FAILED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const QUESTION_CATEGORIES = [
  'History',
  'Examination',
  'Diagnosis',
  'Differential Diagnosis',
  'Investigation',
  'Management',
  'Complications',
  'Emergency',
  'Interpretation',
  'Pharmacology',
  'Follow-up',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const EXTRACTION_DECISIONS = ['PENDING', 'APPROVED', 'REJECTED', 'EDITED'] as const;
export type ExtractionDecision = (typeof EXTRACTION_DECISIONS)[number];

export const KNOWLEDGE_ORIGINS = ['seed', 'ingestion', 'manual'] as const;
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];

/** Seconds. Architecture supports any positive duration; UI currently offers 180 and 240. */
export const DEFAULT_PREPARATION_OPTIONS_SECONDS = [180, 240] as const;

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;

export interface Specialty {
  id: SpecialtyId;
  nameEn: string;
  nameAr: string;
  shortEn: string;
  shortAr: string;
  accent: string;
}

export interface Examiner {
  id: string;
  name: string;
  nameAr: string;
  departmentId: SpecialtyId;
  aliases: string[];
  active: boolean;
  /** Examination-related only. Never personal/private data. */
  metadata: {
    sample: boolean;
    notes?: string;
  };
}

export interface ClinicalCase {
  id: string;
  departmentId: SpecialtyId;
  title: string;
  titleAr?: string;
  clinicalScenario: string;
  presentation?: string;
  difficulty: 'introductory' | 'standard' | 'advanced';
  tags: string[];
  sourceDocumentIds: string[];
  sample: boolean;
}

export interface Question {
  id: string;
  caseId: string;
  questionText: string;
  expectedAnswer: string;
  explanation?: string;
  category: QuestionCategory;
  difficulty: 'introductory' | 'standard' | 'advanced';
  sourceDocumentIds: string[];
  sample: boolean;
  canonicalQuestion: string;
  observedVariants: string[];
}

/**
 * The product's unique relationship: examiner historically asked this
 * question about this case. Never collapse to Case → Questions alone.
 */
export interface ExaminerQuestion {
  id: string;
  examinerId: string;
  questionId: string;
  caseId: string;
  timesObserved: number;
  yearsObserved: number[];
  lastObserved?: number;
  sourceReferences: string[];
  frequencyScore: number;
}

export interface QuestionOccurrence {
  id: string;
  examinerId: string;
  questionId: string;
  year?: number;
  sourceDocumentId: string;
  sourceText: string;
  confidence: number;
}

export interface KnowledgeDocument {
  id: string;
  filename: string;
  fileType: string;
  uploadedAt: string;
  processingStatus: DocumentStatus;
  department?: SpecialtyId;
  sourceYear?: number;
  processedAt?: string;
  version: number;
  originalText?: string;
  error?: string;
}

export interface ExtractionCandidate {
  id: string;
  documentId: string;
  specialtyId?: SpecialtyId;
  examinerName?: string;
  examinerId?: string;
  caseTitle?: string;
  caseId?: string;
  questionText?: string;
  expectedAnswer?: string;
  category?: QuestionCategory;
  year?: number;
  sourceText: string;
  confidence: number;
  band: ConfidenceBand;
  decision: ExtractionDecision;
  reviewRequired: boolean;
}

export interface StudentAnswer {
  questionId: string;
  studentAnswer: string;
  revealedAt?: string;
  answeredAt: string;
  correctness: Correctness;
  score: number;
  evaluation?: EvaluationResult;
  selfEvaluated: boolean;
}

export interface EvaluationResult {
  score: number;
  correctness: Correctness;
  coveredPoints: string[];
  missingPoints: string[];
  feedback: string;
  confidence: number;
  source: 'heuristic' | 'self' | 'llm';
}

export interface CategoryScore {
  category: QuestionCategory;
  total: number;
  earned: number;
}

export interface ExamScores {
  percent: number;
  totalQuestions: number;
  correct: number;
  partial: number;
  incorrect: number;
  byCategory: CategoryScore[];
  strong: QuestionCategory[];
  needsReview: QuestionCategory[];
  missedQuestionIds: string[];
}

export interface ExamSession {
  id: string;
  studentId?: string;
  specialtyId: SpecialtyId;
  examinerId: string;
  caseId: string;
  examinerMode: ExaminerMode;
  caseMode: CaseMode;
  preparationDuration: number;
  startedAt: string | null;
  preparationEndsAt: string | null;
  questioningStartedAt: string | null;
  completedAt: string | null;
  status: ExamStatus;
  questionSequence: string[];
  currentQuestionIndex: number;
  answers: StudentAnswer[];
  scores: ExamScores | null;
  createdAt: string;
}

export interface CreateExamRequest {
  specialtyId: SpecialtyId;
  examinerMode: ExaminerMode;
  examinerId?: string | null;
  caseMode?: CaseMode;
  caseId?: string | null;
  preparationDuration: number;
  studentId?: string;
}

export const SPECIALTIES: readonly Specialty[] = [
  {
    id: 'internal-medicine',
    nameEn: 'Internal Medicine',
    nameAr: 'الباطنية',
    shortEn: 'Medicine',
    shortAr: 'باطنية',
    accent: '#7A2E2A',
  },
  {
    id: 'pediatrics',
    nameEn: 'Pediatrics',
    nameAr: 'طب الأطفال',
    shortEn: 'Pediatrics',
    shortAr: 'أطفال',
    accent: '#1C4A45',
  },
  {
    id: 'surgery',
    nameEn: 'Surgery',
    nameAr: 'الجراحة',
    shortEn: 'Surgery',
    shortAr: 'جراحة',
    accent: '#2A3F5C',
  },
  {
    id: 'minor-specialties',
    nameEn: 'Minor Specialties',
    nameAr: 'التخصصات الصغرى',
    shortEn: 'Minors',
    shortAr: 'ماينورات',
    accent: '#6A4E2C',
  },
  {
    id: 'obstetrics-gynecology',
    nameEn: 'Obstetrics & Gynecology',
    nameAr: 'النسائية والتوليد',
    shortEn: 'OB/GYN',
    shortAr: 'نسائية',
    accent: '#5A3148',
  },
] as const;

export function specialtyById(id: string): Specialty | undefined {
  return SPECIALTIES.find((s) => s.id === id);
}

export function isSpecialtyId(id: string): id is SpecialtyId {
  return (SPECIALTY_IDS as readonly string[]).includes(id);
}

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'HIGH';
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}

export function requiresReview(confidence: number): boolean {
  return confidence < HIGH_CONFIDENCE_THRESHOLD;
}

export function correctnessScore(correctness: Correctness): number {
  switch (correctness) {
    case 'CORRECT':
      return 1;
    case 'PARTIAL':
      return 0.5;
    case 'INCORRECT':
      return 0;
  }
}

export function scoreToCorrectness(score: number): Correctness {
  if (score >= 0.85) return 'CORRECT';
  if (score >= 0.4) return 'PARTIAL';
  return 'INCORRECT';
}
