import {
  assertTestDatabaseUrl,
  DEFAULT_TEST_DATABASE_URL,
  isSafeTestDatabaseUrl,
  redactUrl,
} from '../src/platform/database-safety.js';
import { closePool } from '../src/platform/db.js';
import { migrate, resetTestDatabase } from '../src/platform/migrate.js';

/**
 * Rebuilds the test schema once per run.
 *
 * Dropping and re-migrating (rather than truncating) means the tests also
 * exercise the migration path on every run — a migration that does not apply
 * cleanly fails the suite instead of failing a deploy.
 *
 * This file used to resolve its database with `process.env.DATABASE_URL ??=`,
 * which reads as a default and behaves as an override: whatever the shell
 * already had, won. A developer who ran `source apps/api/.env` first therefore
 * pointed the drop at their development database, and it went. Two things made
 * that invisible rather than loud:
 *
 *   * `resetDatabase` permits `_dev`, correctly, because `pnpm db:reset` is
 *     supposed to reset the development database.
 *   * Vitest's `test.env` block applies to the test workers, NOT to this file —
 *     global setup runs in the parent process. So the workers still connected
 *     to `studentos_test` while the drop landed on `studentos_dev`, and the
 *     suite then ran against a test database nobody had reset. Stale rows from
 *     previous runs are what actually failed the assertions, which pointed
 *     investigation at the tests instead of at the environment.
 *
 * The environment is now resolved here and nowhere else, and an ambient
 * `DATABASE_URL` that disagrees is a hard failure rather than a silent winner.
 */

/**
 * The one place the test database is chosen.
 *
 * `TEST_DATABASE_URL` if set, the local default otherwise — and never
 * `DATABASE_URL`, which is the variable that carries a developer's own
 * database and has no business selecting a target for a destructive reset.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;
  assertTestDatabaseUrl(url, 'The integration suite', env.NODE_ENV);
  return url;
}

export async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test-only-secret-value-that-is-long-enough-0123456789';

  const testUrl = resolveTestDatabaseUrl();
  const ambient = process.env.DATABASE_URL?.trim();

  /*
   * An ambient DATABASE_URL that is not this run's test database is refused
   * rather than overwritten.
   *
   * Overwriting would be safe — the reset would land on the right database —
   * but it would also hide a misconfigured shell from the person who has it,
   * and they are about to run migrations, seeds and scripts from that same
   * shell where nothing will override anything. Failing here costs one command
   * and tells them something true about their environment.
   */
  if (ambient && ambient !== testUrl) {
    throw new Error(
      'The integration suite refused: DATABASE_URL is set in this environment and does not ' +
        'match the test database.\n\n' +
        `  DATABASE_URL       ${redactUrl(ambient)}\n` +
        `  test database      ${redactUrl(testUrl)}\n\n` +
        (isSafeTestDatabaseUrl(ambient, 'test')
          ? 'Both look like test databases, but only one can be right. Set TEST_DATABASE_URL to ' +
            'the one you mean, or unset DATABASE_URL.'
          : 'The suite DROPS THE SCHEMA of the database it runs against, and DATABASE_URL is ' +
            'not a disposable test database — this is how a development database gets wiped. ' +
            'Unset DATABASE_URL (a `source apps/api/.env` in this shell is the usual cause) ' +
            'and run again.'),
    );
  }

  // Set, not defaulted: from here the test database is the only database.
  process.env.DATABASE_URL = testUrl;

  await resetTestDatabase();
  await migrate();
  await closePool();
}

export async function teardown(): Promise<void> {
  await closePool();
}
