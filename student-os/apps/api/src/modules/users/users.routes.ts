import {
  completeOnboardingRequestSchema,
  errorEnvelopeSchema,
  handleAvailabilityQuerySchema,
  handleAvailabilitySchema,
  handleSchema,
  privacySettingsSchema,
  profileSchema,
  updatePrivacySettingsRequestSchema,
  updateProfileRequestSchema,
} from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as service from './users.service.js';

/**
 * Profile HTTP surface.
 */

/**
 * Resolves the response language.
 *
 * Academic names are stored in both Arabic and English; the server must not
 * guess, because guessing wrong degrades the product for one of the two primary
 * languages. Arabic is the default because it is the primary language of the
 * target cohort (§62).
 */
function localeOf(request: FastifyRequest): 'ar' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/profile',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'The authenticated user’s own profile',
        response: { 200: profileSchema, 401: errorEnvelopeSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.getOwnProfile(request.actor!, localeOf(request)),
  );

  app.post(
    '/me/onboarding',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Complete onboarding and join a cohort',
        body: completeOnboardingRequestSchema,
        response: {
          200: profileSchema,
          409: errorEnvelopeSchema,
          412: errorEnvelopeSchema,
        },
      },
    },
    async (request) => service.completeOnboarding(request.actor!, request.body, localeOf(request)),
  );

  app.patch(
    '/me/profile',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Update own profile',
        body: updateProfileRequestSchema,
        response: { 200: profileSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.updateProfile(request.actor!, request.body, localeOf(request)),
  );

  app.get(
    '/me/privacy',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Read privacy settings',
        response: { 200: privacySettingsSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.getPrivacySettings(request.actor!.userId),
  );

  app.patch(
    '/me/privacy',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Update privacy settings',
        body: updatePrivacySettingsRequestSchema,
        response: { 200: privacySettingsSchema, 401: errorEnvelopeSchema },
      },
    },
    async (request) => service.updatePrivacySettings(request.actor!.userId, request.body),
  );

  app.get(
    '/handles/available',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['users'],
        summary: 'Check whether a handle is free',
        querystring: handleAvailabilityQuerySchema,
        response: { 200: handleAvailabilitySchema },
      },
    },
    async (request) => ({
      handle: request.query.handle,
      available: await service.checkHandleAvailable(request.query.handle),
    }),
  );

  app.get(
    '/profiles/:handle',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Read another student’s profile',
        params: z.object({ handle: handleSchema }),
        response: { 200: profileSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.getProfileByHandle(request.params.handle, request.actor, localeOf(request)),
  );
};