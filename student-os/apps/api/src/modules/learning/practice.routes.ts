import {
  errorEnvelopeSchema,
  practiceAnswerResultSchema,
  practiceSessionSchema,
  submitPracticeAnswerRequestSchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as practice from './practice.service.js';

/**
 * Practice — two routes, and deliberately no more.
 *
 * Everything the learning loop needs is here: enter from a topic, answer a
 * question, see what the system now knows. There is no quiz browser, no attempt
 * history, no "submit attempt", no leaderboard and no recommendation endpoint,
 * because none of those is required to prove that an observation reaches
 * `learning_progress` and comes back out on the surfaces that read it.
 *
 * Both are POSTs. The first looks like a read and is not: it opens an attempt
 * and emits `quiz_started`, and a GET that writes is the kind of thing a
 * prefetch turns into a bug report nobody can reproduce.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export const practiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/topics/:topicId/practice',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['learning'],
        summary: 'Start or resume practice on a topic',
        description:
          'Returns the questions without their answers. A second call while an attempt is ' +
          'open returns the same attempt rather than starting another, so leaving the screen ' +
          'and coming back resumes where the student stopped. 404 when the topic has no ' +
          'practicable questions for this student — a published quiz in one of their courses.',
        params: z.object({ topicId: uuidSchema }),
        response: { 200: practiceSessionSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      practice.startSession(request.actor!, request.params.topicId, localeOf(request)),
  );

  app.post(
    '/practice/attempts/:attemptId/answers',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        tags: ['learning'],
        summary: 'Answer one practice question',
        description:
          'Grades the selection on the server, records it, and rolls it into the student’s ' +
          'per-topic learning signal — all in one transaction. Retrying a submission changes ' +
          'nothing and returns the stored verdict — including a retry of the final answer, ' +
          'which arrives after the attempt has closed itself. Only questions from the ' +
          'attempt’s own topic are answerable. An attempt that belongs to another student ' +
          'is a 404, not a 403.',
        params: z.object({ attemptId: uuidSchema }),
        body: submitPracticeAnswerRequestSchema,
        response: { 200: practiceAnswerResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      practice.submitAnswer(request.actor!, request.params.attemptId, request.body),
  );
};
