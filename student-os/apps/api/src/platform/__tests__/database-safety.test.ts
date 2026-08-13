import { describe, expect, it } from 'vitest';
import {
  assertTestDatabaseUrl,
  checkTestDatabaseUrl,
  DEFAULT_TEST_DATABASE_URL,
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
