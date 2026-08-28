import type { Correctness, ExamScores, ExamStatus, QuestionCategory, Specialty } from '@/domain/models';

export interface PresentedExaminer {
  id: string;
  name: string;
  nameAr: string;
  sample: boolean;
}

export interface PresentedCase {
  id: string;
  title: string;
  titleAr?: string;
  clinicalScenario: string;
  tags: string[];
  sample: boolean;
}

export interface PresentedQuestion {
  id: string;
  index: number;
  questionText: string;
  category?: QuestionCategory;
  expectedAnswer?: string;
  explanation?: string;
  sample: boolean;
  answer?: {
    questionId: string;
    studentAnswer: string;
    revealedAt?: string;
    correctness: Correctness;
    score: number;
    evaluation?: {
      score: number;
      correctness: Correctness;
      coveredPoints: string[];
      missingPoints: string[];
      feedback: string;
    };
    selfEvaluated: boolean;
  };
}

export interface PresentedSession {
  id: string;
  status: ExamStatus;
  specialty: Specialty | undefined;
  examiner: PresentedExaminer | null;
  case: PresentedCase | null;
  examinerMode: string;
  preparationDuration: number;
  startedAt: string | null;
  preparationEndsAt: string | null;
  remainingPreparationSeconds: number | null;
  currentQuestionIndex: number;
  questionCount: number;
  questions: PresentedQuestion[];
  scores: ExamScores | null;
  sampleBanner: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ExaminerSummary {
  id: string;
  name: string;
  nameAr: string;
  departmentId: string;
  availableCases: number;
  historicalQuestions: number;
  sample: boolean;
}

export interface SpecialtySummary extends Specialty {
  examinerCount: number;
  caseCount: number;
  questionCount: number;
  sample: boolean;
}
