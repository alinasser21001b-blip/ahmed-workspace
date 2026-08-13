import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isHealthy } from '../../platform/db.js';
import { isSchemaCurrent } from '../../platform/migrate.js';

/**
 * Liveness and readiness (§82).
 *
 * `/health` answers "is the process up?" — it must not touch the database, or a
 * database blip will cause an orchestrator to kill healthy processes.
 * `/health/ready` answers "can this instance serve traffic?" and therefore does
 * check the database and whether migrations are current.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['platform'],
        summary: 'Liveness probe',
        response: { 200: z.object({ status: z.literal('ok'), uptimeSeconds: z.number() }) },
      },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['platform'],
        summary: 'Readiness probe',
        response: {
          200: z.object({ status: z.literal('ready'), database: z.boolean(), schema: z.boolean() }),
          503: z.object({ status: z.literal('not_ready'), database: z.boolean(), schema: z.boolean() }),
        },
      },
    },
    async (_request, reply) => {
      const [database, schema] = await Promise.all([isHealthy(), isSchemaCurrent()]);
      if (database && schema) {
        return reply.send({ status: 'ready' as const, database, schema });
      }
      return reply.status(503).send({ status: 'not_ready' as const, database, schema });
    },
  );
};
