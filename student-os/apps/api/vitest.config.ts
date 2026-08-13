import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a REAL Postgres, not a mock.
 *
 * Permission bugs — the class of bug this product can least afford — do not
 * reproduce against a mocked database, because the mock agrees with whatever
 * the code believes. `TEST_DATABASE_URL` points at a disposable database that
 * globalSetup drops and rebuilds.
 */
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
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/studentos_test',
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
    },
  },
});
