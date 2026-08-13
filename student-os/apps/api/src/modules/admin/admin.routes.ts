import {
  adminUserSearchQuerySchema,
  adminUserSummarySchema,
  errorEnvelopeSchema,
  setVerificationRequestSchema,
  uuidSchema,
  verificationAuditEntrySchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as admin from './admin.service.js';

/**
 * Admin V0 (Phase 5c).
 *
 * Four endpoints, one subject: who is academically eligible to teach.
 *
 * Every route carries `requireAuth` only, and the administrator check lives in
 * the service, where it is `canSetVerificationLevel` from the policy layer.
 * Fastify has a `requireRole` decorator that would do it at the route, and it
 * is deliberately not used: two places that decide who is an administrator are
 * two places that can disagree, and ADR-0003 has one authorization layer. The
 * route states its auth posture; the policy states its authority.
 */

const userParams = z.object({ userId: uuidSchema });

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/admin/users',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Find an account by handle, name or email — administrators only',
        description:
          'The lookup step of the verification workflow. Returns standing, not history: ' +
          'enough to be sure the right account is in front of you before changing it.',
        querystring: adminUserSearchQuerySchema,
        response: {
          200: z.object({ items: z.array(adminUserSummarySchema) }),
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => admin.searchUsers(request.actor!, request.query),
  );

  app.get(
    '/admin/users/:userId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['admin'],
        summary: 'One account’s current verification state — administrators only',
        params: userParams,
        response: {
          200: adminUserSummarySchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => admin.getUser(request.actor!, request.params.userId),
  );

  app.put(
    '/admin/users/:userId/verification',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Grant or revoke academic eligibility — administrators only',
        description:
          'Grant and revoke are one operation with different arguments, so both are audited ' +
          'in the same shape. Takes effect on the target’s very next request: the Actor is ' +
          'hydrated per request, so there is no cache to invalidate and no session to expire. ' +
          'Classroom membership is untouched — a revoked instructor stops publishing and ' +
          'remains the owner of any room they hold, so it can be transferred or archived ' +
          'rather than stranded.',
        params: userParams,
        body: setVerificationRequestSchema,
        response: {
          200: adminUserSummarySchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      admin.setVerificationLevel(
        request.actor!,
        request.params.userId,
        request.body,
        request.requestId || null,
      ),
  );

  app.get(
    '/admin/users/:userId/verification-history',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['admin'],
        summary: 'The audit trail for one account — administrators only',
        description:
          'Read back from `audit_log`, which is append-only: there is no route here that ' +
          'edits or deletes an entry, and none is planned. A record that can be revised is ' +
          'not a record.',
        params: userParams,
        response: {
          200: z.object({ items: z.array(verificationAuditEntrySchema) }),
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => admin.listVerificationHistory(request.actor!, request.params.userId),
  );
};
