import {
  createMuteRequestSchema,
  createReportRequestSchema,
  errorEnvelopeSchema,
  handleSchema,
  listFollowsQuerySchema,
  profileSummaryPageSchema,
  relationshipSchema,
  reportAcknowledgementSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as service from './social.service.js';

/**
 * Social graph and reporting HTTP surface.
 *
 * Everything is keyed by handle rather than by user id. A handle is what
 * appears in the UI and in a URL; requiring the client to resolve an id first
 * would add a round trip and an opportunity to get the wrong person.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const handleParams = z.object({ handle: handleSchema });

export const socialRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/profiles/:handle/relationship',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Read the viewer’s relationship to a profile',
        params: handleParams,
        response: { 200: relationshipSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.getRelationshipByHandle(request.actor!, request.params.handle),
  );

  app.put(
    '/profiles/:handle/follow',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['social'],
        summary: 'Follow a student',
        params: handleParams,
        response: { 200: relationshipSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.followByHandle(request.actor!, request.params.handle),
  );

  app.delete(
    '/profiles/:handle/follow',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Unfollow a student',
        params: handleParams,
        response: { 200: relationshipSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.unfollowByHandle(request.actor!, request.params.handle),
  );

  app.put(
    '/profiles/:handle/block',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Block a student',
        params: handleParams,
        body: z.object({ reason: z.string().max(500).nullable().optional() }),
        response: { 200: relationshipSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.blockByHandle(request.actor!, request.params.handle, request.body.reason ?? null),
  );

  app.delete(
    '/profiles/:handle/block',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Unblock a student',
        params: handleParams,
        response: { 200: relationshipSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.unblockByHandle(request.actor!, request.params.handle),
  );

  app.get(
    '/profiles/:handle/followers',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'List followers',
        params: handleParams,
        querystring: listFollowsQuerySchema,
        response: { 200: profileSummaryPageSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.listFollows(
        request.actor!,
        request.params.handle,
        'followers',
        { cursor: request.query.cursor, limit: request.query.limit },
        localeOf(request),
      ),
  );

  app.get(
    '/profiles/:handle/following',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'List who a student follows',
        params: handleParams,
        querystring: listFollowsQuerySchema,
        response: { 200: profileSummaryPageSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.listFollows(
        request.actor!,
        request.params.handle,
        'following',
        { cursor: request.query.cursor, limit: request.query.limit },
        localeOf(request),
      ),
  );

  app.put(
    '/mutes',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Mute a user, group, community or topic',
        body: createMuteRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.muteTarget(request.actor!, request.body);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/mutes',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['social'],
        summary: 'Remove a mute',
        body: createMuteRequestSchema.pick({ targetType: true, targetId: true }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.unmuteTarget(request.actor!, request.body);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/reports',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['moderation'],
        summary: 'Report content, a comment, or a profile',
        body: createReportRequestSchema,
        response: {
          201: reportAcknowledgementSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await service.createReport(request.actor!, request.body);
      return reply.status(201).send(created);
    },
  );
};
