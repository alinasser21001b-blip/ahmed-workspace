import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Request identity and access logging.
 *
 * Every request gets an id — either the caller's `x-request-id` or a fresh
 * UUID. It is attached to the request logger, echoed in the response header,
 * and included in every error envelope. That last part is what turns "it broke"
 * into a log query.
 */

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

/** Bounded so a caller cannot inject an unbounded string into every log line. */
const MAX_INBOUND_ID_LENGTH = 128;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

export const requestContextPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (request, reply) => {
    const inbound = request.headers['x-request-id'];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

    request.requestId =
      candidate && candidate.length <= MAX_INBOUND_ID_LENGTH && SAFE_ID.test(candidate)
        ? candidate
        : randomUUID();

    reply.header('x-request-id', request.requestId);
    request.log = request.log.child({ requestId: request.requestId });
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        actorId: request.actor?.userId ?? null,
      },
      'request completed',
    );
  });
}, { name: 'request-context' });
