import {
  conversationPageSchema,
  conversationSchema,
  createConversationRequestSchema,
  errorEnvelopeSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadRequestSchema,
  markReadResponseSchema,
  messagePageSchema,
  messageSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  updateMessageRequestSchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as service from './conversations.service.js';

/**
 * Messaging.
 *
 * Every write is HTTP, including sending. The realtime socket is a notification
 * channel, not a command channel — so a send survives a dead socket, a retry is
 * idempotent by `clientMessageId`, and an offline queue is a list of ordinary
 * requests to replay rather than a bespoke protocol.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const conversationParams = z.object({ conversationId: uuidSchema });
const messageParams = z.object({ messageId: uuidSchema });

export const messagingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/conversations',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['messaging'],
        summary: 'The chat list, most recent first',
        querystring: listConversationsQuerySchema,
        response: { 200: conversationPageSchema },
      },
    },
    async (request) =>
      service.listConversations(request.actor!, request.query, localeOf(request)),
  );

  app.post(
    '/conversations',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['messaging'],
        summary: 'Open a direct conversation, or a group’s. Idempotent.',
        body: createConversationRequestSchema,
        response: { 200: conversationSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.createConversation(request.actor!, request.body, localeOf(request)),
  );

  app.get(
    '/conversations/:conversationId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['messaging'],
        summary: 'One conversation',
        params: conversationParams,
        response: { 200: conversationSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.getConversation(request.actor!, request.params.conversationId, localeOf(request)),
  );

  app.get(
    '/conversations/:conversationId/messages',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['messaging'],
        summary: 'A page of messages, by seq',
        description:
          'Paginated by sequence, never by timestamp: two messages can share a millisecond and ' +
          'none can share a seq. `beforeSeq` scrolls backwards; `afterSeq` replays a reconnect gap.',
        params: conversationParams,
        querystring: listMessagesQuerySchema,
        response: { 200: messagePageSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.listMessages(request.actor!, request.params.conversationId, request.query),
  );

  app.post(
    '/conversations/:conversationId/messages',
    {
      onRequest: [app.requireAuth],
      // Generous: a fast typist in an active thread is not abuse, and the
      // idempotency key means a retry storm costs one row, not many.
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        tags: ['messaging'],
        summary: 'Send a message',
        description:
          'Idempotent on `clientMessageId`. Re-sending after a dropped response returns the ' +
          'stored message with `deduplicated: true`, the same id and the same seq.',
        params: conversationParams,
        body: sendMessageRequestSchema,
        response: {
          201: sendMessageResponseSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.sendMessage(
        request.actor!,
        request.params.conversationId,
        request.body,
      );
      return reply.status(201).send(result);
    },
  );

  app.put(
    '/conversations/:conversationId/read',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        tags: ['messaging'],
        summary: 'Advance your own read position',
        description:
          'Monotonic and clamped to the conversation head: a late receipt cannot rewind the ' +
          'position, and a client cannot mark itself read past messages it has never seen.',
        params: conversationParams,
        body: markReadRequestSchema,
        response: { 200: markReadResponseSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.markRead(request.actor!, request.params.conversationId, request.body.seq),
  );

  app.patch(
    '/messages/:messageId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['messaging'],
        summary: 'Edit your own message',
        params: messageParams,
        body: updateMessageRequestSchema,
        response: { 200: messageSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.editMessage(request.actor!, request.params.messageId, request.body.body),
  );

  app.delete(
    '/messages/:messageId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['messaging'],
        summary: 'Delete a message — sender, or a conversation moderator',
        params: messageParams,
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.deleteMessage(request.actor!, request.params.messageId);
      return reply.status(204).send(null);
    },
  );
};
