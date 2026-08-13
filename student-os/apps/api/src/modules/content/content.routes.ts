import {
  bookmarkRequestSchema,
  bookmarkResultSchema,
  commentPageSchema,
  commentSchema,
  contentItemSchema,
  createCommentRequestSchema,
  createPostRequestSchema,
  errorEnvelopeSchema,
  feedPageSchema,
  feedQuerySchema,
  listCommentsQuerySchema,
  markViewedRequestSchema,
  reactionResultSchema,
  setReactionRequestSchema,
  updateCommentRequestSchema,
  updatePostRequestSchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as comments from './comments.service.js';
import * as service from './content.service.js';

/**
 * Content HTTP surface: posts, the feed, comments, reactions, bookmarks.
 */

function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

/** Writes are cheap to abuse and expensive to moderate, so they get their own budget. */
const WRITE_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

export const contentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/feed',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Read a page of the feed',
        querystring: feedQuerySchema,
        response: { 200: feedPageSchema, 400: errorEnvelopeSchema },
      },
    },
    async (request) => service.listFeed(request.actor!, request.query, localeOf(request)),
  );

  app.post(
    '/content',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Create a post',
        body: createPostRequestSchema,
        response: {
          201: contentItemSchema,
          403: errorEnvelopeSchema,
          412: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await service.createPost(request.actor!, request.body, localeOf(request));
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/content/:contentId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Read one item',
        params: z.object({ contentId: uuidSchema }),
        response: { 200: contentItemSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.getContent(request.actor, request.params.contentId, localeOf(request)),
  );

  app.patch(
    '/content/:contentId',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Edit an own post',
        params: z.object({ contentId: uuidSchema }),
        body: updatePostRequestSchema,
        response: { 200: contentItemSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.updatePost(
        request.actor!,
        request.params.contentId,
        request.body,
        localeOf(request),
      ),
  );

  app.delete(
    '/content/:contentId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Delete a post',
        params: z.object({ contentId: uuidSchema }),
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.deletePost(request.actor!, request.params.contentId);
      return reply.status(204).send(null);
    },
  );

  // --- reactions ------------------------------------------------------------

  app.put(
    '/content/:contentId/reaction',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Set or change a reaction',
        params: z.object({ contentId: uuidSchema }),
        body: setReactionRequestSchema,
        response: { 200: reactionResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.setReaction(request.actor!, request.params.contentId, request.body.kind),
  );

  app.delete(
    '/content/:contentId/reaction',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Remove a reaction',
        params: z.object({ contentId: uuidSchema }),
        response: { 200: reactionResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.removeReaction(request.actor!, request.params.contentId),
  );

  // --- bookmarks ------------------------------------------------------------

  app.put(
    '/content/:contentId/bookmark',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Save an item',
        params: z.object({ contentId: uuidSchema }),
        body: bookmarkRequestSchema,
        response: { 200: bookmarkResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      service.addBookmark(request.actor!, request.params.contentId, request.body.collection ?? null),
  );

  app.delete(
    '/content/:contentId/bookmark',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Unsave an item',
        params: z.object({ contentId: uuidSchema }),
        response: { 200: bookmarkResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.removeBookmark(request.actor!, request.params.contentId),
  );

  app.post(
    '/content/:contentId/view',
    {
      onRequest: [app.requireAuth],
      // Views are reported per impression, so this is the highest-volume write
      // in the product and needs a correspondingly generous limit.
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['content'],
        summary: 'Record that the viewer saw an item',
        params: z.object({ contentId: uuidSchema }),
        body: markViewedRequestSchema,
        response: { 204: z.null(), 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.markViewed(
        request.actor!,
        request.params.contentId,
        request.body.completion ?? null,
      );
      return reply.status(204).send(null);
    },
  );

  // --- comments -------------------------------------------------------------

  app.get(
    '/content/:contentId/comments',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'List a thread',
        params: z.object({ contentId: uuidSchema }),
        querystring: listCommentsQuerySchema,
        response: { 200: commentPageSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      comments.listComments(
        request.actor!,
        request.params.contentId,
        { cursor: request.query.cursor, limit: request.query.limit },
        localeOf(request),
      ),
  );

  app.post(
    '/content/:contentId/comments',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Add a comment or reply',
        params: z.object({ contentId: uuidSchema }),
        body: createCommentRequestSchema,
        response: { 201: commentSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const created = await comments.createComment(
        request.actor!,
        request.params.contentId,
        request.body,
        localeOf(request),
      );
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/comments/:commentId',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'Edit an own comment',
        params: z.object({ commentId: uuidSchema }),
        body: updateCommentRequestSchema,
        response: { 200: commentSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      comments.updateComment(
        request.actor!,
        request.params.commentId,
        request.body.body,
        localeOf(request),
      ),
  );

  app.delete(
    '/comments/:commentId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Delete a comment',
        params: z.object({ commentId: uuidSchema }),
        response: { 204: z.null(), 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await comments.deleteComment(request.actor!, request.params.commentId);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/comments/:commentId/reaction',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: WRITE_RATE_LIMIT },
      schema: {
        tags: ['content'],
        summary: 'React to a comment',
        params: z.object({ commentId: uuidSchema }),
        body: setReactionRequestSchema,
        response: { 200: reactionResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      comments.setCommentReaction(request.actor!, request.params.commentId, request.body.kind),
  );

  app.delete(
    '/comments/:commentId/reaction',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['content'],
        summary: 'Remove a reaction from a comment',
        params: z.object({ commentId: uuidSchema }),
        response: { 200: reactionResultSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) =>
      comments.removeCommentReaction(request.actor!, request.params.commentId),
  );
};
