import {
  authSessionSchema,
  authUserSchema,
  errorEnvelopeSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getConfig } from '../../platform/config.js';
import { deliverPasswordResetEmail } from '../../platform/mailer.js';
import * as service from './auth.service.js';

/**
 * The response `/forgot-password` always sends, regardless of what happened
 * behind it. One constant, used from the one call site, so there is no second
 * copy of this string that could someday drift and start saying something
 * different for the two branches it must not distinguish.
 */
const FORGOT_PASSWORD_MESSAGE =
  'If an account exists for that email address, a password reset link has been sent to it.';

/**
 * Auth HTTP surface.
 *
 * Routes declare schema and auth posture and nothing else — no business logic
 * lives in a handler.
 *
 * Auth endpoints carry their own tighter rate limit: the platform-wide limit is
 * sized for normal browsing, which is far too generous for credential attempts.
 */

const AUTH_RATE_LIMIT = {
  max: getConfig().env.AUTH_RATE_LIMIT_MAX,
  timeWindow: '1 minute',
};

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const meta = (request: { headers: Record<string, unknown>; ip: string }): service.RequestMeta => ({
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    ip: request.ip,
  });

  app.post(
    '/signup',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: signupRequestSchema,
        response: { 201: authSessionSchema, 409: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const session = await service.signup(request.body, meta(request));
      return reply.status(201).send(session);
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for tokens',
        body: loginRequestSchema,
        response: { 200: authSessionSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.login(request.body, meta(request)),
  );

  app.post(
    '/forgot-password',
    {
      // Tighter than a normal write, and tighter still would be reasonable:
      // this is the one unauthenticated endpoint whose entire job is to do
      // something to an arbitrary email address on request.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Request a password reset link',
        description:
          'Always responds the same way, whether or not the email belongs to an account — ' +
          'the response must not be usable to test which emails are registered. Delivery is ' +
          'a separate concern (see `platform/mailer.ts`) and its absence does not change what ' +
          'this endpoint returns.',
        body: forgotPasswordRequestSchema,
        response: { 202: forgotPasswordResponseSchema },
      },
    },
    async (request, reply) => {
      await service.requestPasswordReset(request.body.email, (input) =>
        deliverPasswordResetEmail(input),
      );
      return reply.status(202).send({ message: FORGOT_PASSWORD_MESSAGE });
    },
  );

  app.post(
    '/reset-password',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Redeem a reset token for a new password',
        description:
          'Single-use and time-boxed. Revokes every existing session for the account and ' +
          'signs the caller into a fresh one — a password reset is frequently a recovery from ' +
          'credential theft, and a session opened before it must not outlive it.',
        body: resetPasswordRequestSchema,
        response: { 200: authSessionSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.resetPassword(request.body.token, request.body.newPassword, meta(request)),
  );

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token',
        body: refreshRequestSchema,
        response: { 200: authSessionSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.refresh(request.body.refreshToken, meta(request)),
  );

  app.post(
    '/logout',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current session, or every session',
        body: logoutRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.logout(request.actor!.userId, {
        ...(request.body.refreshToken ? { refreshToken: request.body.refreshToken } : {}),
        allDevices: request.body.allDevices,
      });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['auth'],
        summary: 'The authenticated account',
        response: { 200: authUserSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.currentUser(request.actor!.userId),
  );
};
