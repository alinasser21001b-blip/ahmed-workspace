import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../config.js';
import { LocalStorageDriver, getStorage, setStorage, type StorageDriver } from '../storage.js';

/**
 * The point of `STORAGE_DRIVER=external` is that it cannot degrade quietly.
 *
 * A deployment on a platform with its own object store registers a driver at
 * boot. If that registration is ever dropped — a refactor, a reordered import,
 * a host that changed its startup — the failure has to be immediate and loud.
 * The alternative is uploads landing on an instance's local disk and vanishing
 * with it, which looks like working software right up until someone comes back
 * for their file.
 */

const ORIGINAL = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
}

beforeEach(() => {
  setStorage(null);
  withEnv({
    DATABASE_URL: 'postgres://localhost:5432/studentos_test',
    JWT_SECRET: 'a-secret-that-is-at-least-thirty-two-characters-long',
    NODE_ENV: 'test',
  });
});

afterEach(() => {
  setStorage(null);
  process.env = { ...ORIGINAL };
  resetConfigCache();
});

describe('getStorage', () => {
  it('refuses to serve when STORAGE_DRIVER=external and nothing was registered', () => {
    withEnv({ STORAGE_DRIVER: 'external' });
    expect(() => getStorage()).toThrow(/no driver was registered/i);
  });

  it('keeps refusing rather than settling for local disk on a second call', () => {
    withEnv({ STORAGE_DRIVER: 'external' });
    expect(() => getStorage()).toThrow();
    // The failure must not cache a fallback: every call refuses until a driver
    // is actually registered.
    expect(() => getStorage()).toThrow(/no driver was registered/i);
  });

  it('uses the registered driver when the host supplies one', () => {
    withEnv({ STORAGE_DRIVER: 'external' });
    const fake: StorageDriver = {
      name: 'fake',
      put: async () => {},
      get: async () => Buffer.alloc(0),
      delete: async () => {},
    };
    setStorage(fake);
    expect(getStorage()).toBe(fake);
  });

  it('still defaults to the local driver in development', () => {
    withEnv({ STORAGE_DRIVER: undefined });
    expect(getStorage()).toBeInstanceOf(LocalStorageDriver);
  });
});
