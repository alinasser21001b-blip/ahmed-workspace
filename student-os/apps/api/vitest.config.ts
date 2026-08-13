import { defineConfig } from 'vitest/config';
import {
  assertTestDatabaseUrl,
  DEFAULT_TEST_DATABASE_URL,
} from './src/platform/database-safety.js';

/**
 * Integration tests run against a REAL Postgres, not a mock.
 *
 * Permission bugs — the class of bug this product can least afford — do not
 * reproduce against a mocked database, because the mock agrees with whatever
 * the code believes. `TEST_DATABASE_URL` points at a disposable database that
 * globalSetup drops and rebuilds.
 *
 * The URL is resolved here from `TEST_DATABASE_URL` alone and asserted against
 * the test-database contract before Vitest starts. Two details matter:
 *
 *   * `DATABASE_URL` is deliberately NOT consulted. It is the variable that
 *     holds a developer's own database, and letting it select the target of a
 *     destructive reset is exactly the failure this configuration now prevents.
 *   * This block sets the environment of the test WORKERS. `globalSetup` runs
 *     in the parent process and does not see it, which is why the same contract
 *     is asserted again there and a third time at the reset itself. They must
 *     agree, so they read one module rather than each restating the rule.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;

// Fails at config load, before a single test runs and before anything connects.
assertTestDatabaseUrl(TEST_DATABASE_URL, 'The integration suite', 'test');

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // The suites share one database; running them in parallel would let one
    // suite's truncation delete another's fixtures mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'test-only-secret-value-that-is-long-enough-0123456789',
      DATABASE_URL: TEST_DATABASE_URL,
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
    },
  },
});
