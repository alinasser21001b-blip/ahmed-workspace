import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { getConfig } from './config.js';

/**
 * Object storage.
 *
 * Behind an interface from day one so that the local-disk driver used in
 * development and the S3-compatible driver used in production are
 * interchangeable, and so that no call site anywhere knows which is active.
 *
 * The database never stores bytes (§49) — only a `storage_key` that a driver
 * resolves.
 */

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/**
 * Local filesystem driver — development and test only.
 *
 * The key is treated as hostile: it is normalised and then verified to still
 * resolve inside the root. Skipping that check is the classic path-traversal
 * hole, where a key of `../../etc/passwd` reads whatever the process can.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolveKey(key: string): string {
    const target = resolve(this.root, normalize(key));
    const rootWithSep = resolve(this.root) + sep;
    if (!target.startsWith(rootWithSep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}

/**
 * S3-compatible driver.
 *
 * Not implemented in Phase 0/2 — no bucket exists yet, and a driver that has
 * never run against real storage is worse than an honest gap. Constructing it
 * fails loudly rather than silently degrading to local disk, which would put
 * user uploads on an ephemeral container filesystem in production.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';

  constructor() {
    throw new Error(
      'S3StorageDriver is not implemented yet. Set STORAGE_DRIVER=local, or implement this ' +
        'driver before deploying with STORAGE_DRIVER=s3.',
    );
  }

  put(): Promise<void> {
    throw new Error('not implemented');
  }
  get(): Promise<Buffer> {
    throw new Error('not implemented');
  }
  delete(): Promise<void> {
    throw new Error('not implemented');
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const { env } = getConfig();

  if (env.STORAGE_DRIVER === 'external') {
    // Reached only if the host forgot to register one. Refusing here is the
    // whole point of the mode: silently writing to disk instead would put
    // uploads on a filesystem that disappears with the instance.
    throw new Error(
      'STORAGE_DRIVER=external, but no driver was registered. The host must call ' +
        'setStorage() during boot, before the first request.',
    );
  }

  driver =
    env.STORAGE_DRIVER === 's3'
      ? new S3StorageDriver()
      : new LocalStorageDriver(env.STORAGE_LOCAL_DIR);

  return driver;
}

/**
 * Registers the active driver.
 *
 * Two callers: tests, which swap in a fake, and a deployment host running with
 * `STORAGE_DRIVER=external`, which supplies its platform's object store.
 */
export function setStorage(next: StorageDriver | null): void {
  driver = next;
}

/**
 * Builds a storage key.
 *
 * Sharded by owner and date so that no single directory accumulates every
 * upload in the system — which matters for the local driver and for anything
 * that ever has to list a prefix.
 */
export function buildStorageKey(ownerId: string, fileId: string, extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return join('uploads', String(yyyy), mm, ownerId, `${fileId}.${extension}`);
}

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
