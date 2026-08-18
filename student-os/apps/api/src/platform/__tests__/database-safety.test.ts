import { describe, expect, it } from 'vitest';
import {
  assertResettableDatabaseUrl,
  assertTestDatabaseUrl,
  checkResettableDatabaseUrl,
  checkTestDatabaseUrl,
  DEFAULT_TEST_DATABASE_URL,
  isSafeResettableDatabaseUrl,
  isSafeTestDatabaseUrl,
  redactUrl,
} from '../database-safety.js';

/**
 * The contract that decides where a destructive test reset may point.
 *
 * These are the cheapest tests in the repository and they guard the most
 * expensive mistake: the integration suite once dropped a developer's
 * development database because the rule was a `??=` default rather than a
 * check. Each case below is a URL that must or must not be allowed to be
 * dropped, written out so that loosening the rule breaks a test rather than
 * merely changing behaviour nobody is watching.
 */

const local = (name: string): string => `postgres://postgres:postgres@localhost:5432/${name}`;

describe('the test-database contract', () => {
  it('accepts the documented default', () => {
    expect(checkTestDatabaseUrl(DEFAULT_TEST_DATABASE_URL, 'test')).toBeNull();
  });

  it.each([
    ['studentos_test', local('studentos_test')],
    ['a differently named test database', local('anything_test')],
    ['127.0.0.1', 'postgres://postgres:postgres@127.0.0.1:5432/studentos_test'],
    ['a container hostname', 'postgres://postgres:postgres@postgres:5432/studentos_test'],
    ['a compose service alias', 'postgres://user:pw@db:5432/ci_test'],
  ])('accepts %s', (_label, url) => {
    expect(isSafeTestDatabaseUrl(url, 'test')).toBe(true);
  });

  /*
   * The development database is the case that actually happened. It is local,
   * it is Postgres, and every loose heuristic accepts it — only the name rule
   * catches it, which is why the name rule exists.
   */
  it('refuses the development database', () => {
    const rejection = checkTestDatabaseUrl(local('studentos_dev'), 'test');
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toContain('studentos_dev');
  });

  it.each([
    ['a database with no suffix', local('studentos')],
    ['a name that merely contains _test', local('studentos_testing')],
    ['a production-looking name', local('studentos_production')],
  ])('refuses %s', (_label, url) => {
    expect(isSafeTestDatabaseUrl(url, 'test')).toBe(false);
  });

  it('refuses a public host even when the name ends in _test', () => {
    const rejection = checkTestDatabaseUrl(
      'postgres://user:pw@db.prod.example.com:5432/studentos_test',
      'test',
    );
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toContain('public name');
  });

  it('refuses a managed-host connection string outright', () => {
    expect(
      isSafeTestDatabaseUrl('postgres://u:p@abc.eu-west-1.rds.amazonaws.com:5432/app_test', 'test'),
    ).toBe(false);
  });

  it('refuses everything when NODE_ENV is production', () => {
    // Even the known-good default: production is not a place tests run.
    expect(isSafeTestDatabaseUrl(DEFAULT_TEST_DATABASE_URL, 'production')).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL', 'studentos_test'],
  ])('refuses a missing or malformed URL (%s)', (_label, url) => {
    expect(isSafeTestDatabaseUrl(url, 'test')).toBe(false);
  });

  it('refuses a URL that names no database', () => {
    expect(isSafeTestDatabaseUrl('postgres://postgres:postgres@localhost:5432/', 'test')).toBe(
      false,
    );
  });
});

describe('assertTestDatabaseUrl', () => {
  it('passes a safe URL through without throwing', () => {
    expect(() => assertTestDatabaseUrl(DEFAULT_TEST_DATABASE_URL, 'test context', 'test')).not.toThrow();
  });

  it('names the refusing layer and explains the likely cause', () => {
    let message = '';
    try {
      assertTestDatabaseUrl(local('studentos_dev'), 'resetTestDatabase', 'test');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('resetTestDatabase refused');
    // The message has to name the actual cause, because the person reading it
    // is about to lose a database if they guess wrong.
    expect(message).toContain('source apps/api/.env');
    expect(message).toContain('TEST_DATABASE_URL');
  });
});

describe('the developer-reset contract (checkResettableDatabaseUrl)', () => {
  /*
   * `resetDatabase` used to check a single regex, `/_test|_dev|localhost|
   * 127\.0\.0\.1/`, against the WHOLE connection string as an OR — a
   * substring match with no idea which field it was matching inside. These
   * cases are exactly the ones that regex got wrong.
   */

  it.each([
    ['a dev database', local('studentos_dev')],
    ['a demo database', local('studentos_demo')],
    ['a test database', local('studentos_test')],
    ['a container hostname', 'postgres://postgres:postgres@postgres:5432/studentos_dev'],
  ])('accepts %s', (_label, url) => {
    expect(isSafeResettableDatabaseUrl(url, 'test')).toBe(true);
  });

  it('refuses a database literally named "...development" even though it contains "_dev"', () => {
    // The old regex matched "_dev" as a substring of "_development" and let this through.
    const rejection = checkResettableDatabaseUrl(local('studentos_development'), 'test');
    expect(rejection).not.toBeNull();
  });

  it('refuses a production host even when the password merely contains the word "localhost"', () => {
    // The old regex matched "localhost" anywhere in the string, password included — even
    // though the database name here otherwise satisfies the disposable-suffix rule.
    const url = 'postgres://user:localhost-backup-key@prod-primary.example.com:5432/studentos_dev';
    const rejection = checkResettableDatabaseUrl(url, 'test');
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toContain('public name');
  });

  it('refuses a production-looking database on a public host even with "_test" in the username', () => {
    // The old regex matched "_test" anywhere, including inside a username.
    const url = 'postgres://qa_test_readonly:pw@prod.example.com:5432/production';
    expect(isSafeResettableDatabaseUrl(url, 'test')).toBe(false);
  });

  it('refuses a public host even when the database name ends in a disposable suffix', () => {
    expect(
      isSafeResettableDatabaseUrl('postgres://u:p@db.prod.example.com:5432/studentos_test', 'test'),
    ).toBe(false);
  });

  it('refuses a disposable-suffix name on a managed-host connection string', () => {
    expect(
      isSafeResettableDatabaseUrl(
        'postgres://u:p@abc.eu-west-1.rds.amazonaws.com:5432/app_dev',
        'test',
      ),
    ).toBe(false);
  });

  it('refuses everything when NODE_ENV is production', () => {
    expect(isSafeResettableDatabaseUrl(local('studentos_dev'), 'production')).toBe(false);
  });
});

describe('assertResettableDatabaseUrl', () => {
  it('passes a safe URL through without throwing', () => {
    expect(() =>
      assertResettableDatabaseUrl(local('studentos_dev'), 'resetDatabase', 'test'),
    ).not.toThrow();
  });

  it('names the refusing layer', () => {
    let message = '';
    try {
      assertResettableDatabaseUrl(undefined, 'resetDatabase', 'test');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('resetDatabase refused');
  });
});

describe('redactUrl', () => {
  it('removes the password so a URL can go in an error message', () => {
    const redacted = redactUrl('postgres://postgres:hunter2@localhost:5432/studentos_test');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('localhost');
    expect(redacted).toContain('studentos_test');
  });

  it('does not throw on an unparseable string', () => {
    expect(redactUrl('nonsense')).toBe('<unparseable connection string>');
  });
});
