import {
  authSessionSchema,
  authUserSchema,
  errorEnvelopeSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  signupRequestSchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getConfig } from '../../platform/config.js';
import * as service from './auth.service.js';

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
