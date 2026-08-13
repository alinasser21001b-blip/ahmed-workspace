import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the API package.
 *
 * A separate config from `vitest.config.ts` for one reason: the integration
 * config carries `globalSetup`, which drops and rebuilds a database. Running
 * pure functions through that would make `pnpm test:unit` require Postgres and
 * would give a unit run the power to destroy a schema — a large amount of
 * authority for a suite that only ever needs to call a function and compare a
 * string.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
