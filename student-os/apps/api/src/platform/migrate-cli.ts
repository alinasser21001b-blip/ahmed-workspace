import { closePool } from './db.js';
import { migrate, resetDatabase } from './migrate.js';

/**
 * CLI entry point for migrations. Run as its own step before the app starts,
 * never from inside the request path.
 */
async function main(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');

  if (shouldReset) {
    process.stdout.write('resetting schema…\n');
    await resetDatabase();
  }

  const { applied, skipped } = await migrate({
    log: (message) => process.stdout.write(`${message}\n`),
  });

  process.stdout.write(
    applied.length === 0
      ? `schema is up to date (${skipped.length} migrations)\n`
      : `applied ${applied.length} migration(s)\n`,
  );
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    await closePool().catch(() => {});
    process.exit(1);
  });
