import { z } from 'zod';
import {
  CASE_MODES,
  CORRECTNESS_VALUES,
  EXAMINER_MODES,
  SPECIALTY_IDS,
} from '../domain/models';

export const createExamRequestSchema = z.object({
  specialtyId: z.enum(SPECIALTY_IDS),
  examinerMode: z.enum(EXAMINER_MODES),
  examinerId: z.string().min(1).nullable().optional(),
  caseMode: z.enum(CASE_MODES).optional(),
  caseId: z.string().min(1).nullable().optional(),
  preparationDuration: z.number().int().positive(),
  studentId: z.string().min(1).optional(),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  studentAnswer: z.string(),
  correctness: z.enum(CORRECTNESS_VALUES).optional(),
});

export const reviewDecisionSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED', 'EDITED']),
  questionText: z.string().optional(),
  expectedAnswer: z.string().optional(),
  examinerName: z.string().optional(),
  caseTitle: z.string().optional(),
  specialtyId: z.enum(SPECIALTY_IDS).optional(),
});
