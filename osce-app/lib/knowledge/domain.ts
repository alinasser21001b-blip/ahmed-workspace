import { z } from 'zod';

export const specialtyIds = ['INTERNAL_MEDICINE', 'PEDIATRICS', 'SURGERY', 'MINOR_SPECIALTIES', 'OBSTETRICS_GYNECOLOGY'] as const;
export type SpecialtyId = (typeof specialtyIds)[number];
export const documentStatuses = ['UPLOADED', 'EXTRACTING_TEXT', 'EXTRACTING_KNOWLEDGE', 'REVIEW_REQUIRED', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];
export const candidateSchema = z.object({
  kind: z.enum(['EXAMINER', 'CASE', 'QUESTION']),
  name: z.string().min(1),
  examiner: z.string().optional(), caseTitle: z.string().optional(), answer: z.string().optional(),
  category: z.string().default('OTHER'), year: z.number().int().min(2000).max(2100).optional(),
  page: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive(), excerpt: z.string().min(1),
});
export type ExtractionCandidate = z.infer<typeof candidateSchema>;
export const extractionSchema = z.object({ specialtyId: z.enum(specialtyIds).optional(), candidates: z.array(candidateSchema), warnings: z.array(z.string()) });
export type ExtractionResult = z.infer<typeof extractionSchema>;
export interface KnowledgeExtractionProvider { extract(input: { text: string; filename: string }): Promise<ExtractionResult>; }
