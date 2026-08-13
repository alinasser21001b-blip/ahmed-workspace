import {
  addSourceRequestSchema,
  contentCorrectionSchema,
  contentSourceSchema,
  errorEnvelopeSchema,
  feedPageSchema,
  learnOverviewSchema,
  listTopicKnowledgeQuerySchema,
  proposeCorrectionRequestSchema,
  resolveCorrectionRequestSchema,
  topicDetailSchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as knowledge from './knowledge.service.js';
import * as topics from './topics.service.js';

/**
 * Knowledge: provenance, corrections, topics and the Learn surface.
 *
 * Sources and corrections hang off a content id rather than living at the top
 * level, because their visibility IS the content's visibility. Routing them
 * through `/content/:id/...` makes that structural rather than a rule someone
 * has to remember.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const contentParams = z.object({ contentId: uuidSchema });
const sourceParams = z.object({ contentId: uuidSchema, sourceId: uuidSchema });
const correctionParams = z.object({ contentId: uuidSchema, correctionId: uuidSchema });
const topicParams = z.object({ topicId: uuidSchema });

export const knowledgeRoutes: FastifyPluginAsyncZod = async (app) => {
  // --- sources --------------------------------------------------------------

  app.get(
    '/content/:contentId/sources',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Citations attached to a piece of knowledge',
        params: contentParams,
        response: { 200: z.array(contentSourceSchema), 404: errorEnvelopeSchema },
      },
    },
    async (request) => knowledge.listSources(request.actor!, request.params.contentId),
  );

  app.post(
    '/content/:contentId/sources',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['knowledge'],
        summary: 'Attach a citation',
        description:
          'Anyone who can see the content may cite it, not only its author: finding the ' +
          'textbook page for a classmate’s explanation improves the knowledge, and `addedBy` ' +
          'records who made the claim.',
        params: contentParams,
        body: addSourceRequestSchema,
        response: { 201: contentSourceSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const source = await knowledge.addSource(
        request.actor!,
        request.params.contentId,
        request.body,
      );
      return reply.status(201).send(source);
    },
  );

  app.delete(
    '/content/:contentId/sources/:sourceId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Remove a citation — whoever added it, or whoever can delete the content',
        params: sourceParams,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await knowledge.removeSource(
        request.actor!,
        request.params.contentId,
        request.params.sourceId,
      );
      return reply.status(204).send(null);
    },
  );

  // --- corrections ----------------------------------------------------------

  app.get(
    '/content/:contentId/corrections',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Corrections proposed against a piece of knowledge',
        params: contentParams,
        response: { 200: z.array(contentCorrectionSchema), 404: errorEnvelopeSchema },
      },
    },
    async (request) => knowledge.listCorrections(request.actor!, request.params.contentId),
  );

  app.post(
    '/content/:contentId/corrections',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['knowledge'],
        summary: 'Propose a correction',
        description:
          'A claim that the content is wrong, with a lifecycle the author resolves. Not a ' +
          'comment: a later reader must see it whether or not they read the thread. The ' +
          'author cannot correct their own content — they edit it.',
        params: contentParams,
        body: proposeCorrectionRequestSchema,
        response: {
          201: contentCorrectionSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const correction = await knowledge.proposeCorrection(
        request.actor!,
        request.params.contentId,
        request.body,
      );
      return reply.status(201).send(correction);
    },
  );

  app.patch(
    '/content/:contentId/corrections/:correctionId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Accept or reject a correction — the author, or a container moderator',
        params: correctionParams,
        body: resolveCorrectionRequestSchema,
        response: {
          200: contentCorrectionSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      knowledge.resolveCorrection(
        request.actor!,
        request.params.contentId,
        request.params.correctionId,
        request.body.status,
      ),
  );

  app.delete(
    '/content/:contentId/corrections/:correctionId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Withdraw your own proposed correction',
        params: correctionParams,
        response: { 204: z.null(), 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await knowledge.withdrawCorrection(
        request.actor!,
        request.params.contentId,
        request.params.correctionId,
      );
      return reply.status(204).send(null);
    },
  );

  // --- topics ---------------------------------------------------------------

  app.get(
    '/topics/:topicId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'A topic as a place: hierarchy, related concepts, and what is in it',
        description:
          'The hierarchy is reference data every signed-in student may read. The knowledge ' +
          'counts run the feed’s permission predicate — a count that included content the ' +
          'reader cannot open would leak just as surely as a row.',
        params: topicParams,
        response: { 200: topicDetailSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => topics.getTopic(request.actor!, request.params.topicId, localeOf(request)),
  );

  app.get(
    '/topics/:topicId/knowledge',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'Knowledge about a topic, filtered deterministically',
        description:
          'Filters are equality on classified columns — no relevance model, so a student can ' +
          'always tell why a row is in the list.',
        params: topicParams,
        querystring: listTopicKnowledgeQuerySchema,
        response: { 200: feedPageSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      topics.listTopicKnowledge(
        request.actor!,
        request.params.topicId,
        request.query,
        localeOf(request),
      ),
  );

  // --- learn ----------------------------------------------------------------

  app.get(
    '/learn',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['knowledge'],
        summary: 'The Learn surface, built only from signals that exist',
        response: { 200: learnOverviewSchema },
      },
    },
    async (request) => topics.learnOverview(request.actor!, localeOf(request)),
  );
};
