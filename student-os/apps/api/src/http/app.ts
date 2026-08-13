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
import { academicRoutes } from '../modules/academic/academic.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
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
    exposedHeaders: ['x-request-id'],
  });

  await app.register(rateLimit, {
    global: true,
    max: config.env.RATE_LIMIT_MAX,
    timeWindow: config.env.RATE_LIMIT_WINDOW,
    // Rate limit per authenticated user where possible so that a shared campus
    // NAT does not throttle a whole cohort as one client.
    keyGenerator: (request) => request.actor?.userId ?? request.ip,
  });

  await app.register(authenticatePlugin);
  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(academicRoutes, { prefix: '/v1/academic' });
  await app.register(usersRoutes, { prefix: '/v1' });

  return app;
}

/** The fully-configured instance type, including the Zod type provider. */
export type App = Awaited<ReturnType<typeof buildApp>>;
