import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { getConfig } from '../platform/config.js';
import { getLogger } from '../platform/logger.js';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { academicRoutes } from '../modules/academic/academic.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { contentRoutes } from '../modules/content/content.routes.js';
import { filesRoutes } from '../modules/files/files.routes.js';
import { groupsRoutes } from '../modules/groups/groups.routes.js';
import { knowledgeRoutes } from '../modules/knowledge/knowledge.routes.js';
import { messagingRoutes } from '../modules/messaging/messaging.routes.js';
import { realtimeRoutes } from '../modules/messaging/realtime.routes.js';
import { socialRoutes } from '../modules/social/social.routes.js';
import { healthRoutes } from '../modules/health/health.routes.js';
import { usersRoutes } from '../modules/users/users.routes.js';
import { authenticatePlugin } from './plugins/authenticate.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { requestContextPlugin } from './plugins/request-context.js';

/**
 * Application assembly.
 *
 * Order matters and is load-bearing:
 *   1. request context — so every later log line and error carries a request id
 *   2. security headers, CORS, rate limit — cheapest rejections first
 *   3. authentication — resolves the actor for every request
 *   4. error handler — must be registered before routes to catch their throws
 *   5. routes
 */
export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    loggerInstance: getLogger(),
    // The request id is minted by our own plugin, and access logging is done in
    // one line by the request-context hook; Fastify's built-in pair would be a
    // second, conflicting identity and a duplicate log line per request.
    // Deprecated in favour of `logController` in Fastify 6 — migrate when we
    // upgrade; the replacement requires supplying the full controller object.
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB. File uploads go to object storage, not here.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  // Zod is the single source of truth for both validation and serialisation.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(requestContextPlugin);

  await app.register(helmet, {
    // The API serves JSON to a native client and a web build; a CSP here would
    // apply to nothing it serves.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    // Must be explicit: the default set omits PUT, PATCH and DELETE, which
    // silently breaks every mutation from a browser client while leaving reads
    // working — a failure mode that looks like a client bug for days.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'accept', 'accept-language', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.env.RATE_LIMIT_MAX,
    timeWindow: config.env.RATE_LIMIT_WINDOW,
    // Rate limit per authenticated user where possible so that a shared campus
    // NAT does not throttle a whole cohort as one client.
    keyGenerator: (request) => request.actor?.userId ?? request.ip,
  });

  // Uploads bypass the 1 MiB JSON body limit; the per-file cap is enforced by
  // the upload route and re-checked against the actual byte count.
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 },
  });

  /*
   * The realtime transport. Registered before the routes that use it, and after
   * the rate limiter so a connection storm is still bounded.
   *
   * `maxPayload` is small on purpose: every frame this endpoint accepts is a
   * subscription or an ephemeral hint. Nothing arriving over the socket becomes
   * a database write, so nothing arriving over it needs to be large.
   */
  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
  });

  await app.register(authenticatePlugin);
  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(academicRoutes, { prefix: '/v1/academic' });
  await app.register(usersRoutes, { prefix: '/v1' });
  await app.register(filesRoutes, { prefix: '/v1' });
  await app.register(contentRoutes, { prefix: '/v1' });
  await app.register(socialRoutes, { prefix: '/v1' });
  await app.register(groupsRoutes, { prefix: '/v1' });
  await app.register(messagingRoutes, { prefix: '/v1' });
  await app.register(knowledgeRoutes, { prefix: '/v1' });
  await app.register(realtimeRoutes, { prefix: '/v1' });

  return app;
}

/** The fully-configured instance type, including the Zod type provider. */
export type App = Awaited<ReturnType<typeof buildApp>>;
