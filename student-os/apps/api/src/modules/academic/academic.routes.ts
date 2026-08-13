import {
  academicYearSchema,
  collegeSchema,
  courseSchema,
  listAcademicYearsQuerySchema,
  listCollegesQuerySchema,
  listCoursesQuerySchema,
  listProgramsQuerySchema,
  listStagesQuerySchema,
  programSchema,
  stageSchema,
  subjectSchema,
  topicSchema,
  universitySchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as repo from './academic.repository.js';

/**
 * Academic hierarchy endpoints.
 *
 * Reference data, readable by any authenticated caller and by the onboarding
 * flow. Nothing here is user-specific, so nothing here is permission-filtered —
 * see the note in the repository.
 */
export const academicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/universities',
    {
      schema: {
        tags: ['academic'],
        summary: 'List universities',
        response: { 200: z.array(universitySchema) },
      },
    },
    async () => repo.listUniversities(),
  );

  app.get(
    '/colleges',
    {
      schema: {
        tags: ['academic'],
        summary: 'List colleges in a university',
        querystring: listCollegesQuerySchema,
        response: { 200: z.array(collegeSchema) },
      },
    },
    async (request) => repo.listColleges(request.query.universityId),
  );

  app.get(
    '/programs',
    {
      schema: {
        tags: ['academic'],
        summary: 'List programs in a college',
        querystring: listProgramsQuerySchema,
        response: { 200: z.array(programSchema) },
      },
    },
    async (request) => repo.listPrograms(request.query.collegeId),
  );

  app.get(
    '/stages',
    {
      schema: {
        tags: ['academic'],
        summary: 'List stages in a program',
        querystring: listStagesQuerySchema,
        response: { 200: z.array(stageSchema) },
      },
    },
    async (request) => repo.listStages(request.query.programId),
  );

  app.get(
    '/academic-years',
    {
      schema: {
        tags: ['academic'],
        summary: 'List academic years for a university',
        querystring: listAcademicYearsQuerySchema,
        response: { 200: z.array(academicYearSchema) },
      },
    },
    async (request) => repo.listAcademicYears(request.query.universityId),
  );

  app.get(
    '/courses',
    {
      schema: {
        tags: ['academic'],
        summary: 'List courses for a stage or program',
        querystring: listCoursesQuerySchema,
        response: { 200: z.array(courseSchema) },
      },
    },
    async (request) =>
      repo.listCourses({
        ...(request.query.stageId ? { stageId: request.query.stageId } : {}),
        ...(request.query.programId ? { programId: request.query.programId } : {}),
      }),
  );

  app.get(
    '/courses/:courseId/subjects',
    {
      schema: {
        tags: ['academic'],
        summary: 'List subjects in a course',
        params: z.object({ courseId: uuidSchema }),
        response: { 200: z.array(subjectSchema) },
      },
    },
    async (request) => repo.listSubjects(request.params.courseId),
  );

  app.get(
    '/topics',
    {
      schema: {
        tags: ['academic'],
        summary: 'List topics in a subject or course',
        querystring: z.object({
          subjectId: uuidSchema.optional(),
          courseId: uuidSchema.optional(),
        }),
        response: { 200: z.array(topicSchema) },
      },
    },
    async (request) =>
      repo.listTopics({
        ...(request.query.subjectId ? { subjectId: request.query.subjectId } : {}),
        ...(request.query.courseId ? { courseId: request.query.courseId } : {}),
      }),
  );
};
