import { createId } from '../../lib/ids';
import type {
  ClinicalCase,
  ExtractionCandidate,
  Examiner,
  ExaminerQuestion,
  KnowledgeDocument,
  Question,
  QuestionOccurrence,
  SpecialtyId,
} from '../models';
import { findCanonicalQuestion, mergeVariant } from './dedupe';

export interface KnowledgeMutation {
  examiners: Examiner[];
  cases: ClinicalCase[];
  questions: Question[];
  examinerQuestions: ExaminerQuestion[];
  occurrences: QuestionOccurrence[];
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function applyApprovedCandidates(
  candidates: readonly ExtractionCandidate[],
  knowledge: {
    examiners: Examiner[];
    cases: ClinicalCase[];
    questions: Question[];
    examinerQuestions: ExaminerQuestion[];
    occurrences: QuestionOccurrence[];
  },
  document: KnowledgeDocument,
): KnowledgeMutation {
  const examiners = [...knowledge.examiners];
  const cases = [...knowledge.cases];
  const questions = [...knowledge.questions];
  const examinerQuestions = [...knowledge.examinerQuestions];
  const occurrences = [...knowledge.occurrences];

  for (const candidate of candidates) {
    if (candidate.decision !== 'APPROVED' && candidate.decision !== 'EDITED') continue;
    if (!candidate.questionText || !candidate.expectedAnswer) continue;

    const specialtyId: SpecialtyId = candidate.specialtyId ?? document.department ?? 'pediatrics';

    let examiner = examiners.find((row) => row.id === candidate.examinerId);
    if (!examiner && candidate.examinerName) {
      examiner = examiners.find(
        (row) => row.name.toLowerCase() === candidate.examinerName?.toLowerCase() && row.departmentId === specialtyId,
      );
    }
    if (!examiner && candidate.examinerName) {
      examiner = {
        id: createId('ex'),
        name: candidate.examinerName,
        nameAr: candidate.examinerName,
        departmentId: specialtyId,
        aliases: [candidate.examinerName],
        active: true,
        metadata: { sample: false, notes: `Ingested from ${document.filename}` },
      };
      examiners.push(examiner);
    }
    if (!examiner) continue;

    let clinicalCase = cases.find((row) => row.id === candidate.caseId);
    if (!clinicalCase && candidate.caseTitle) {
      clinicalCase = cases.find(
        (row) => row.title.toLowerCase() === candidate.caseTitle?.toLowerCase() && row.departmentId === specialtyId,
      );
    }
    if (!clinicalCase && candidate.caseTitle) {
      clinicalCase = {
        id: `case_${slug(candidate.caseTitle)}_${createId('c').slice(-6)}`,
        departmentId: specialtyId,
        title: candidate.caseTitle,
        clinicalScenario: candidate.sourceText.slice(0, 600),
        difficulty: 'standard',
        tags: [],
        sourceDocumentIds: [document.id],
        sample: false,
      };
      cases.push(clinicalCase);
    }
    if (!clinicalCase) continue;

    const dup = findCanonicalQuestion(candidate.questionText, questions, clinicalCase.id);
    let question: Question;
    if (dup.isDuplicate && dup.canonicalId) {
      const existing = questions.find((row) => row.id === dup.canonicalId);
      if (!existing) continue;
      question = mergeVariant(existing, candidate.questionText);
      const idx = questions.findIndex((row) => row.id === existing.id);
      questions[idx] = {
        ...question,
        sourceDocumentIds: [...new Set([...question.sourceDocumentIds, document.id])],
      };
      question = questions[idx] as Question;
    } else {
      question = {
        id: createId('q'),
        caseId: clinicalCase.id,
        questionText: candidate.questionText,
        expectedAnswer: candidate.expectedAnswer,
        category: candidate.category ?? 'Diagnosis',
        difficulty: 'standard',
        sourceDocumentIds: [document.id],
        sample: false,
        canonicalQuestion: candidate.questionText,
        observedVariants: [],
      };
      questions.push(question);
    }

    const existingLink = examinerQuestions.find(
      (eq) => eq.examinerId === examiner.id && eq.questionId === question.id && eq.caseId === clinicalCase.id,
    );
    if (existingLink) {
      existingLink.timesObserved += 1;
      if (candidate.year && !existingLink.yearsObserved.includes(candidate.year)) {
        existingLink.yearsObserved = [...existingLink.yearsObserved, candidate.year];
      }
      existingLink.lastObserved = candidate.year ?? existingLink.lastObserved;
      existingLink.sourceReferences = [...new Set([...existingLink.sourceReferences, document.id])];
      existingLink.frequencyScore = existingLink.timesObserved / 10;
    } else {
      examinerQuestions.push({
        id: createId('eq'),
        examinerId: examiner.id,
        questionId: question.id,
        caseId: clinicalCase.id,
        timesObserved: 1,
        yearsObserved: candidate.year ? [candidate.year] : [],
        lastObserved: candidate.year,
        sourceReferences: [document.id],
        frequencyScore: 0.1,
      });
    }

    occurrences.push({
      id: createId('occ'),
      examinerId: examiner.id,
      questionId: question.id,
      year: candidate.year,
      sourceDocumentId: document.id,
      sourceText: candidate.sourceText,
      confidence: candidate.confidence,
    });
  }

  return { examiners, cases, questions, examinerQuestions, occurrences };
}
