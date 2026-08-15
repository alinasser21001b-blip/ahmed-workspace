import {
  blockedAccountSchema,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  errorEnvelopeSchema,
  moderationReportSchema,
  resolveReportRequestSchema,
  supportLinksSchema,
  uuidSchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as account from './account.service.js';
import * as support from './support.service.js';
import * as moderation from '../moderation/moderation.admin.service.js';

/**
 * The account surface App Review requires.
 *
 * Every route here exists because a guideline says a person must be able to
 * reach a capability from inside the app, and each is annotated with which one —
 * so that the next person to consider removing one knows what it costs.
 */
export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  // --- Guideline 5.1.1(v): account deletion ---------------------------------

  app.delete(
    '/me/account',
    {
      onRequest: [app.requireAuth],
      // Tighter than the default write budget. This endpoint is irreversible
      // and password-guarded, which makes it the one place a stolen token would
      // be worth brute-forcing.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        tags: ['account'],
        summary: 'Permanently delete the signed-in account',
        description:
          'Deletes the account and everything attached to it: profile, posts, comments, ' +
          'reactions, bookmarks, memberships, learning record, sessions and push tokens. ' +
          'Messages become tombstones so the other side of a conversation is not renumbered, ' +
          'and their contents are removed. Uploaded objects are deleted from storage. Groups, ' +
          'communities and classrooms the account solely owned are transferred to the most ' +
          'senior remaining member, or archived when there is none. Requires the account ' +
          'password: an access token alone must not be able to destroy an account.',
        body: deleteAccountRequestSchema,
        response: {
          200: deleteAccountResponseSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => account.deleteOwnAccount(request.actor!, { password: request.body.password }),
  );

  // --- Guideline 1.2: the block list ----------------------------------------

  app.get(
    '/me/blocks',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['account'],
        summary: 'Accounts this student has blocked',
        description:
          'Blocking already existed; seeing what you have blocked did not, which made the ' +
          'capability impossible to verify or undo. The blocked person is never told.',
        response: { 200: z.array(blockedAccountSchema), 401: errorEnvelopeSchema },
      },
    },
    async (request) => account.listBlockedAccounts(request.actor!),
  );

  // --- Guidelines 1.5 and 5.1.1(i): support and privacy ---------------------

  app.get(
    '/support/links',
    {
      // Deliberately unauthenticated. Someone who cannot sign in is exactly the
      // person who most needs the support address, and Guideline 1.5 is about
      // people being able to reach the developer — not signed-in people.
      schema: {
        tags: ['account'],
        summary: 'Support, privacy policy and terms URLs',
        description:
          'Served rather than compiled in, so a policy URL can be corrected without an App ' +
          'Store release. Unset values are returned as null and the client renders nothing; ' +
          'the release gate refuses to ship a build whose environment leaves them unset.',
        response: { 200: supportLinksSchema },
      },
    },
    async () => support.links(),
  );

  // --- Guideline 1.2: "timely responses to concerns" ------------------------

  app.get(
    '/moderation/reports',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['moderation'],
        summary: 'The open report queue — platform administrators only',
        querystring: z.object({
          status: z.enum(['open', 'reviewing', 'all']).default('open'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.array(moderationReportSchema),
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      moderation.listQueue(request.actor!, {
        status: request.query.status,
        limit: request.query.limit,
      }),
  );

  app.post(
    '/moderation/reports/:reportId/resolve',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['moderation'],
        summary: 'Close a report and record what was done about it',
        description:
          'Writes the outcome and a `moderation_actions` row in one transaction, and — for ' +
          '`suspend` and `ban` — revokes the target’s sessions so the ejection takes effect ' +
          'immediately rather than whenever their access token happens to expire.',
        params: z.object({ reportId: uuidSchema }),
        body: resolveReportRequestSchema,
        response: {
          204: z.null(),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await moderation.resolve(request.actor!, request.params.reportId, request.body);
      return reply.status(204).send(null);
    },
  );
};
