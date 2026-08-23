import {
  communityPageSchema,
  communitySchema,
  createGroupRequestSchema,
  errorEnvelopeSchema,
  groupPageSchema,
  groupSchema,
  inviteMemberRequestSchema,
  joinGroupRequestSchema,
  joinResultSchema,
  listCommunitiesQuerySchema,
  listGroupsQuerySchema,
  listMembersQuerySchema,
  memberPageSchema,
  searchQuerySchema,
  searchResultsSchema,
  updateGroupRequestSchema,
  updateMemberRequestSchema,
  uuidSchema,
  handleSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as communities from '../communities/communities.service.js';
import * as search from '../search/search.service.js';
import * as service from './groups.service.js';

/**
 * Communities, groups and search.
 *
 * Grouped in one plugin because they are one product surface: a student finds a
 * community, finds a group inside it, and searches across both.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const groupParams = z.object({ groupId: uuidSchema });
const memberParams = z.object({ groupId: uuidSchema, handle: handleSchema });

export const groupsRoutes: FastifyPluginAsyncZod = async (app) => {
  // --- communities ----------------------------------------------------------

  app.get(
    '/communities',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['communities'],
        summary: 'List joined or discoverable communities',
        querystring: listCommunitiesQuerySchema,
        response: { 200: communityPageSchema },
      },
    },
    async (request) =>
      communities.listCommunities(
        request.actor!,
        { scope: request.query.scope, cursor: request.query.cursor, limit: request.query.limit },
        localeOf(request),
      ),
  );

  app.get(
    '/communities/:communityId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['communities'],
        summary: 'Read one community',
        params: z.object({ communityId: uuidSchema }),
        response: { 200: communitySchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      communities.getCommunity(request.actor!, request.params.communityId, localeOf(request)),
  );

  app.put(
    '/communities/:communityId/membership',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['communities'],
        summary: 'Join a community',
        params: z.object({ communityId: uuidSchema }),
        response: { 200: communitySchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema },
      },
    },
    async (request) =>
      communities.joinCommunity(request.actor!, request.params.communityId, localeOf(request)),
  );

  app.delete(
    '/communities/:communityId/membership',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['communities'],
        summary: 'Leave a community',
        params: z.object({ communityId: uuidSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await communities.leaveCommunity(request.actor!, request.params.communityId);
      return reply.status(204).send(null);
    },
  );

  // --- groups ---------------------------------------------------------------

  app.get(
    '/groups',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'List joined or discoverable groups',
        querystring: listGroupsQuerySchema,
        response: { 200: groupPageSchema },
      },
    },
    async (request) => service.listGroups(request.actor!, request.query, localeOf(request)),
  );

  app.post(
    '/groups',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['groups'],
        summary: 'Create a study group',
        body: createGroupRequestSchema,
        response: { 201: groupSchema, 403: errorEnvelopeSchema, 412: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const created = await service.createGroup(request.actor!, request.body, localeOf(request));
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/groups/:groupId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Read one group',
        params: groupParams,
        response: { 200: groupSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.getGroup(request.actor!, request.params.groupId, localeOf(request)),
  );

  app.patch(
    '/groups/:groupId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Update group settings',
        params: groupParams,
        body: updateGroupRequestSchema,
        response: { 200: groupSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.updateGroup(request.actor!, request.params.groupId, request.body, localeOf(request)),
  );

  app.delete(
    '/groups/:groupId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Archive a group',
        params: groupParams,
        response: { 204: z.null(), 403: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.archiveGroup(request.actor!, request.params.groupId);
      return reply.status(204).send(null);
    },
  );

  // --- membership -----------------------------------------------------------

  app.put(
    '/groups/:groupId/membership',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['groups'],
        summary: 'Join a group, or request to join',
        params: groupParams,
        body: joinGroupRequestSchema,
        response: { 200: joinResultSchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.joinGroup(
        request.actor!,
        request.params.groupId,
        request.body.message ?? null,
        localeOf(request),
      ),
  );

  app.delete(
    '/groups/:groupId/membership',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Leave a group',
        params: groupParams,
        response: { 204: z.null(), 409: errorEnvelopeSchema, 412: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.leaveGroup(request.actor!, request.params.groupId);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/groups/:groupId/members',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'List members, or the pending-request queue',
        params: groupParams,
        querystring: listMembersQuerySchema,
        response: { 200: memberPageSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.listMembers(request.actor!, request.params.groupId, request.query, localeOf(request)),
  );

  app.post(
    '/groups/:groupId/invites',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Invite a student',
        params: groupParams,
        body: inviteMemberRequestSchema,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 409: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.inviteMember(request.actor!, request.params.groupId, request.body.handle);
      return reply.status(204).send(null);
    },
  );

  app.patch(
    '/groups/:groupId/members/:handle',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Approve a request, change a role, or ban a member',
        params: memberParams,
        body: updateMemberRequestSchema,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.updateMember(
        request.actor!,
        request.params.groupId,
        request.params.handle,
        request.body,
      );
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/groups/:groupId/members/:handle',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['groups'],
        summary: 'Remove a member',
        params: memberParams,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.removeMember(request.actor!, request.params.groupId, request.params.handle);
      return reply.status(204).send(null);
    },
  );

  // --- search ---------------------------------------------------------------

  app.get(
    '/search',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['search'],
        summary: 'Search people, content, groups, communities, topics and classrooms',
        querystring: searchQuerySchema,
        response: { 200: searchResultsSchema },
      },
    },
    async (request) => search.search(request.actor!, request.query, localeOf(request)),
  );
};
