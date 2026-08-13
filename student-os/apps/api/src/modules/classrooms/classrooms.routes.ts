import {
  addMaterialRequestSchema,
  classroomDetailSchema,
  classroomMemberSchema,
  classroomSummarySchema,
  createClassroomRequestSchema,
  createLectureRequestSchema,
  errorEnvelopeSchema,
  joinClassroomRequestSchema,
  lectureDetailSchema,
  lectureProgressRequestSchema,
  lectureSummarySchema,
  listClassroomsQuerySchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as classrooms from './classrooms.service.js';

/**
 * Classrooms, lectures and materials (Phase 5b).
 *
 * Lectures hang off `/classrooms/:id/lectures` on creation but are addressed
 * directly as `/lectures/:id` afterwards, because a lecture id is what a link
 * to a lecture contains. The service resolves the lecture's classroom and
 * applies the room's gate either way — a direct lecture id is not a way in.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const classroomParams = z.object({ classroomId: uuidSchema });
const lectureParams = z.object({ lectureId: uuidSchema });

export const classroomRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/classrooms',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'Classrooms you are in, or ones you could join',
        description:
          '`mine` filters on membership itself, so a room you are not in cannot appear. ' +
          '`discover` lists only course-visible rooms in courses you are enrolled in — an ' +
          'unlisted room is reachable by join code alone and never appears here.',
        querystring: listClassroomsQuerySchema,
        response: { 200: z.object({ items: z.array(classroomSummarySchema) }) },
      },
    },
    async (request) => classrooms.listClassrooms(request.actor!, request.query, localeOf(request)),
  );

  app.post(
    '/classrooms',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Open a classroom for a course you are enrolled in',
        description:
          'The creator becomes its owner in the same transaction, so a room can never exist ' +
          'without someone who can publish into it.',
        body: createClassroomRequestSchema,
        response: { 201: classroomDetailSchema, 403: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const created = await classrooms.createClassroom(
        request.actor!,
        request.body,
        localeOf(request),
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/classrooms/lookup',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Resolve a join code to the classroom it opens',
        description:
          'Rate-limited because it is the one endpoint that turns a guess into a room. An ' +
          'unknown code is 404, identical to a code for a room that does not exist.',
        querystring: z.object({ joinCode: z.string().trim().min(4).max(32) }),
        response: { 200: classroomSummarySchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      classrooms.findByJoinCode(request.actor!, request.query.joinCode, localeOf(request)),
  );

  app.get(
    '/classrooms/:classroomId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'A classroom you can at least see',
        description:
          'Visible to members, and to anyone enrolled in the course when the room is ' +
          'course-scoped. `joinCode` is present only for teaching staff. 404 — never 403 — ' +
          'when the caller may not see it.',
        params: classroomParams,
        response: { 200: classroomDetailSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      classrooms.getClassroom(request.actor!, request.params.classroomId, localeOf(request)),
  );

  app.put(
    '/classrooms/:classroomId/membership',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Join — by enrolment, or with the join code',
        description:
          'Idempotent: joining twice is one membership row. A banned membership is never ' +
          'reinstated by pressing the button again.',
        params: classroomParams,
        body: joinClassroomRequestSchema,
        response: {
          200: classroomSummarySchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      classrooms.joinClassroom(
        request.actor!,
        request.params.classroomId,
        request.body.joinCode,
        localeOf(request),
      ),
  );

  app.delete(
    '/classrooms/:classroomId/membership',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'Leave — but the owner must transfer or archive instead',
        params: classroomParams,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await classrooms.leaveClassroom(request.actor!, request.params.classroomId);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/classrooms/:classroomId/members',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'The roster — members only',
        description: 'Teaching staff first, then students by join order.',
        params: classroomParams,
        response: {
          200: z.object({ items: z.array(classroomMemberSchema) }),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      classrooms.listMembers(request.actor!, request.params.classroomId, localeOf(request)),
  );

  // --- lectures -------------------------------------------------------------

  app.get(
    '/classrooms/:classroomId/lectures',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'Lectures in a classroom — members only',
        description:
          'Students see published lectures; teaching staff also see drafts. The filter is in ' +
          'the SQL, not applied to the array afterwards.',
        params: classroomParams,
        response: {
          200: z.object({ items: z.array(lectureSummarySchema) }),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => classrooms.listLectures(request.actor!, request.params.classroomId),
  );

  app.post(
    '/classrooms/:classroomId/lectures',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Publish a lecture — teaching staff only',
        description:
          'A student who could publish would make "the instructor published this" meaningless, ' +
          'and that claim is the only thing that makes a classroom more trustworthy than a group.',
        params: classroomParams,
        body: createLectureRequestSchema,
        response: {
          201: lectureSummarySchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await classrooms.createLecture(
        request.actor!,
        request.params.classroomId,
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/lectures/:lectureId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['classrooms'],
        summary: 'A lecture, with its materials as signed URLs',
        description:
          'The lecture inherits its classroom’s permission — the room is resolved and gated ' +
          'here, so holding a lecture id is not a way past membership. Material URLs are signed ' +
          'at read time for a caller who has already passed that gate.',
        params: lectureParams,
        response: { 200: lectureDetailSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      classrooms.getLecture(request.actor!, request.params.lectureId, localeOf(request)),
  );

  app.post(
    '/lectures/:lectureId/materials',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Attach a material — teaching staff only',
        description:
          'An uploaded file is placed into the classroom as it is attached: its visibility ' +
          'becomes `classroom` and its `classroom_id` is stamped, which is what makes ' +
          '`canAccessFile` refuse a non-member.',
        params: lectureParams,
        body: addMaterialRequestSchema,
        response: {
          201: z.object({ id: uuidSchema }),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await classrooms.addMaterial(
        request.actor!,
        request.params.lectureId,
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.put(
    '/lectures/:lectureId/progress',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['classrooms'],
        summary: 'Record how far you have read',
        description:
          'A study-activity signal, never a grade. Monotonic — progress does not go backwards.',
        params: lectureParams,
        body: lectureProgressRequestSchema,
        response: { 204: z.null(), 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await classrooms.recordLectureProgress(
        request.actor!,
        request.params.lectureId,
        request.body.percent,
      );
      return reply.status(204).send(null);
    },
  );
};
