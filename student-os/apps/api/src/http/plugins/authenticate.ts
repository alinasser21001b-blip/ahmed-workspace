import type { Actor } from '@sos/core';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { errors } from '../../platform/errors.js';
import { loadActor, findSessionById } from '../../modules/auth/auth.repository.js';
import { verifyAccessToken } from '../../modules/auth/tokens.js';

/**
 * Authentication.
 *
 * `authenticate` resolves the caller into a fully-loaded `Actor` and attaches
 * it to the request. `requireAuth` and `requireRole` are the guards routes
 * declare. There is deliberately NO implicit default: every route states its
 * own auth posture, so a new endpoint cannot be accidentally public.
 */

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Actor['role'][]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authenticatePlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest('actor', null);

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    const claims = await verifyAccessToken(header.slice('Bearer '.length).trim());
    if (!claims) return;

    /*
     * The access token is stateless, but its session can have been revoked
     * (logout, refresh-token theft detection, admin ban) within its short
     * lifetime. Checking the session row on each request closes that window;
     * it is one indexed primary-key lookup, which is a cheap price for making
     * logout actually mean logout.
     */
    const session = await findSessionById(claims.sid);
    if (!session || session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
      return;
    }

    request.actor = await loadActor(claims.sub);
  });

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.actor) throw errors.unauthenticated();
    if (request.actor.status === 'banned' || request.actor.status === 'suspended') {
      throw errors.accountSuspended(request.actor.status);
    }
  });

  app.decorate(
    'requireRole',
    (...roles: Actor['role'][]) =>
      async (request: FastifyRequest) => {
        if (!request.actor) throw errors.unauthenticated();
        if (!roles.includes(request.actor.role)) {
          throw errors.forbidden('insufficient_role', { required: roles });
        }
      },
  );
}, { name: 'authenticate', dependencies: ['request-context'] });
