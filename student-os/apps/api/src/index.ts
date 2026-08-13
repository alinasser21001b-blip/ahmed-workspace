import { buildApp } from './http/app.js';
import { getConfig } from './platform/config.js';
import { closePool } from './platform/db.js';
import { getLogger } from './platform/logger.js';

/**
 * Server bootstrap.
 *
 * Migrations are NOT run here. They are a separate deploy step, so that a
 * rolling restart cannot have several instances racing to alter the schema
 * while serving traffic.
 */
async function main(): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      // Stop accepting connections first, then drain the pool, so in-flight
      // requests can finish their queries.
      await app.close();
      await closePool();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.env.PORT, host: config.env.HOST });
  logger.info({ port: config.env.PORT, env: config.env.NODE_ENV }, 'api listening');
}

main().catch((error: unknown) => {
  // The logger may not exist yet if config validation is what failed.
  process.stderr.write(`fatal: ${(error as Error).message}\n`);
  process.exit(1);
});
