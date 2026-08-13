import { z } from 'zod';
import { uuidSchema } from '../common/primitives.js';

/**
 * Academic hierarchy contract.
 *
 * Every level exposes both `nameAr` and `nameEn`. The client picks by locale;
 * the server never guesses, because a wrong guess here silently degrades the
 * product for one of the two primary languages.
 */

const namedNode = {
  id: uuidSchema,
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
};

export const universitySchema = z.object({
  ...namedNode,
  country: z.string().nullable(),
  city: z.string().nullable(),
  logoUrl: z.string().nullable(),
});
export type University = z.infer<typeof universitySchema>;

export const collegeSchema = z.object({
  ...namedNode,
  universityId: uuidSchema,
});
export type College = z.infer<typeof collegeSchema>;

export const programSchema = z.object({
  ...namedNode,
  collegeId: uuidSchema,
  degreeType: z.string().nullable(),
  durationYears: z.number().int().nullable(),
});
export type Program = z.infer<typeof programSchema>;

export const stageSchema = z.object({
  id: uuidSchema,
  programId: uuidSchema,
  ordinal: z.number().int(),
  nameAr: z.string(),
  nameEn: z.string(),
});
export type Stage = z.infer<typeof stageSchema>;

export const academicYearSchema = z.object({
  id: uuidSchema,
  universityId: uuidSchema,
  label: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  isCurrent: z.boolean(),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

export const courseSchema = z.object({
  ...namedNode,
  programId: uuidSchema,
  stageId: uuidSchema,
  academicYearId: uuidSchema.nullable(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export type Course = z.infer<typeof courseSchema>;

export const subjectSchema = z.object({
  ...namedNode,
  courseId: uuidSchema,
  ordinal: z.number().int(),
});
export type Subject = z.infer<typeof subjectSchema>;

export const topicSchema = z.object({
  ...namedNode,
  subjectId: uuidSchema,
  parentTopicId: uuidSchema.nullable(),
  ordinal: z.number().int(),
});
export type Topic = z.infer<typeof topicSchema>;

// --- query params -----------------------------------------------------------

export const listCollegesQuerySchema = z.object({ universityId: uuidSchema });
export const listProgramsQuerySchema = z.object({ collegeId: uuidSchema });
export const listStagesQuerySchema = z.object({ programId: uuidSchema });
export const listCoursesQuerySchema = z.object({
  stageId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
});
export const listAcademicYearsQuerySchema = z.object({ universityId: uuidSchema });
