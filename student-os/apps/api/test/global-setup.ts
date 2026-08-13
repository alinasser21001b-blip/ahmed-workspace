import { closePool } from '../src/platform/db.js';
import { migrate, resetDatabase } from '../src/platform/migrate.js';

/**
 * Rebuilds the test schema once per run.
 *
 * Dropping and re-migrating (rather than truncating) means the tests also
 * exercise the migration path on every run — a migration that does not apply
 * cleanly fails the suite instead of failing a deploy.
 */
export async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test-only-secret-value-that-is-long-enough-0123456789';
  process.env.DATABASE_URL ??=
    process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/studentos_test';

  await resetDatabase();
  await migrate();
  await closePool();
}

export async function teardown(): Promise<void> {
  await closePool();
}
