/**
 * The test-database safety contract.
 *
 * The integration suite drops and rebuilds a schema on every run. That is the
 * right design — it exercises the migration path each time instead of trusting
 * it — but it means the suite holds a loaded gun, and the only thing deciding
 * where it points is a connection string.
 *
 * That string used to be taken from the ambient environment with `??=`, which
 * is a default, not a guard. A developer who ran `source apps/api/.env` before
 * `pnpm test:integration` handed the suite their development database and it
 * was dropped — observed, not hypothesised. The old check in `resetDatabase`
 * did not catch it because it deliberately permits `_dev`: resetting the
 * development database is exactly what `pnpm db:reset` is for.
 *
 * So the rule cannot live at the reset call alone. It has to be a separate,
 * stricter contract that only the test path uses, stated once and enforced at
 * every layer that could reach the destructive call.
 *
 * This module is deliberately dependency-free and side-effect-free — no pool,
 * no config, no imports — so that the Vitest config file, the global setup and
 * the migration code can all share one definition without any of them dragging
 * a database connection into a place that should not have one.
 */

/** A database is safe to destroy in tests only if its name ends with this. */
const TEST_DATABASE_SUFFIX = '_test';

/**
 * Suffixes `pnpm db:reset` (the developer reset) may destroy. Wider than the
 * test contract on purpose — see `checkResettableDatabaseUrl` below — but
 * still an explicit, closed list, never a substring match against the whole
 * connection string.
 */
const RESETTABLE_DATABASE_SUFFIXES = ['_test', '_dev', '_demo'];

export const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/studentos_test';

/** Loopback, plus single-label hosts — a container or service name on a private network. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  /*
   * A hostname with no dots cannot be a public DNS name, so it is a Docker
   * service, a Compose alias or a Kubernetes service — private by construction.
   * Every managed Postgres a production URL could point at is a dotted FQDN,
   * which this rejects without needing a blocklist of vendor domains to keep
   * up to date.
   */
  return host.length > 0 && !host.includes('.');
}

export interface TestDatabaseRejection {
  /** Why the URL is not acceptable, phrased for the person who hit it. */
  reason: string;
}

/**
 * Decides whether a connection string may be destroyed by the test suite.
 *
 * Returns `null` when the URL is acceptable, or a rejection explaining what is
 * wrong. Two conditions must both hold, and neither is negotiable:
 *
 *  1. **The database name ends in `_test`.** This is the whole convention. It
 *     rules out `studentos_dev` by name rather than by hoping nobody points at
 *     it, and no production database is called `*_test`.
 *  2. **The host is private.** Loopback, or a single-label container hostname.
 *     A production database lives behind a dotted public name, so it cannot
 *     satisfy this even if someone were to name it `..._test`.
 *
 * Returning a value rather than throwing keeps the function usable from the
 * Vitest config, where a throw at module load produces a stack trace with no
 * explanation of what the developer should do instead.
 */
export function checkTestDatabaseUrl(
  url: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): TestDatabaseRejection | null {
  if (nodeEnv === 'production') {
    return { reason: 'NODE_ENV is "production"; the test suite refuses to run at all.' };
  }
  if (!url || url.trim() === '') {
    return { reason: 'no database URL was given.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: `"${url}" is not a valid connection string.` };
  }

  const name = parsed.pathname.replace(/^\//, '');
  if (name === '') {
    return { reason: `"${redactUrl(url)}" names no database.` };
  }
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    return {
      reason:
        `the database is called "${name}", which does not end in "${TEST_DATABASE_SUFFIX}". ` +
        'The integration suite drops and rebuilds whatever it is pointed at, so it will only ' +
        `point at a database whose name says it is disposable.`,
    };
  }
  if (!isPrivateHost(parsed.hostname)) {
    return {
      reason:
        `the host "${parsed.hostname}" is a public name. A disposable test database lives on ` +
        'localhost or on a container network, never behind a public DNS name.',
    };
  }

  return null;
}

/** True when the URL may be destroyed by the test suite. */
export function isSafeTestDatabaseUrl(
  url: string | undefined,
  nodeEnv?: string | undefined,
): boolean {
  return checkTestDatabaseUrl(url, nodeEnv) === null;
}

/**
 * Throws unless the URL satisfies the contract.
 *
 * `context` names the caller so the message says which layer refused — the
 * setup that resolved the URL, or the reset that was about to run.
 */
export function assertTestDatabaseUrl(
  url: string | undefined,
  context: string,
  nodeEnv?: string | undefined,
): asserts url is string {
  const rejection = checkTestDatabaseUrl(url, nodeEnv);
  if (rejection) {
    throw new Error(
      `${context} refused: ${rejection.reason}\n\n` +
        'The integration suite runs against a dedicated, disposable database and DROPS ITS ' +
        'SCHEMA on every run.\n' +
        `  • Expected: a database named "*${TEST_DATABASE_SUFFIX}" on localhost or a container host.\n` +
        `  • Default:  ${DEFAULT_TEST_DATABASE_URL}\n` +
        '  • Override: set TEST_DATABASE_URL.\n\n' +
        'If you did not mean to point the tests anywhere in particular, the most likely cause ' +
        'is a DATABASE_URL exported into your shell — `source apps/api/.env` does exactly that. ' +
        'Run the tests from a shell without it, or unset DATABASE_URL.',
    );
  }
}

/**
 * Decides whether a connection string may be destroyed by the DEVELOPER reset
 * (`pnpm db:reset`, `resetDatabase` in migrate.ts) or the demo seed's target
 * check.
 *
 * Wider than `checkTestDatabaseUrl` on purpose: wiping your own development
 * or demo database is the entire point of `pnpm db:reset`, so `_dev` and
 * `_demo` are accepted alongside `_test`. But it enforces the SAME two
 * structural conditions as the test contract — a disposable-looking database
 * name suffix AND a private host — rather than the substring-anywhere-in-the-
 * connection-string regex this used to be. That old regex matched on the
 * whole string, so a database literally named "studentos_development" on a
 * public production host would have satisfied it (it contains "_dev"), and
 * so would a URL whose username or password merely happened to contain
 * "test" or "localhost" as a substring. Parsing the URL and checking the
 * database name and hostname as distinct fields closes both.
 */
export function checkResettableDatabaseUrl(
  url: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): TestDatabaseRejection | null {
  if (nodeEnv === 'production') {
    return { reason: 'NODE_ENV is "production"; a database reset refuses to run at all.' };
  }
  if (!url || url.trim() === '') {
    return { reason: 'no database URL was given.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: `"${url}" is not a valid connection string.` };
  }

  const name = parsed.pathname.replace(/^\//, '');
  if (name === '') {
    return { reason: `"${redactUrl(url)}" names no database.` };
  }
  if (!RESETTABLE_DATABASE_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    return {
      reason:
        `the database is called "${name}", which does not end in any of ` +
        `${RESETTABLE_DATABASE_SUFFIXES.map((s) => `"${s}"`).join(', ')}. A reset drops and ` +
        'rebuilds the whole schema, so it will only run against a database whose name says it ' +
        'is disposable.',
    };
  }
  if (!isPrivateHost(parsed.hostname)) {
    return {
      reason:
        `the host "${parsed.hostname}" is a public name. A disposable database lives on ` +
        'localhost or on a container network, never behind a public DNS name.',
    };
  }

  return null;
}

/** True when the URL may be reset by `pnpm db:reset` (or targeted by demo:seed). */
export function isSafeResettableDatabaseUrl(
  url: string | undefined,
  nodeEnv?: string | undefined,
): boolean {
  return checkResettableDatabaseUrl(url, nodeEnv) === null;
}

/** Throws unless the URL satisfies the developer-reset contract. */
export function assertResettableDatabaseUrl(
  url: string | undefined,
  context: string,
  nodeEnv?: string | undefined,
): asserts url is string {
  const rejection = checkResettableDatabaseUrl(url, nodeEnv);
  if (rejection) {
    throw new Error(`${context} refused: ${rejection.reason}`);
  }
}

/** A connection string with its password removed, safe to put in an error message. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<unparseable connection string>';
  }
}
