import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import { getStorage } from '../src/platform/storage.js';
import { auth, closeApp, getApp, onboardedUser, uploadImage } from './helpers.js';

/**
 * Deleting a file has to free the bytes it uploaded, not just hide the row.
 *
 * `deleteOwnFile` used to call only `softDeleteFile` — a `deleted_at = now()`
 * UPDATE — and never touched the storage driver. A student who deleted a
 * photo saw it disappear from the app while the bytes sat in storage
 * forever: unbounded growth on every delete, with no sweep anywhere that
 * ever reclaimed them (the orphaned-upload sweep only targets uploads that
 * were never attached, which a deleted file is not).
 */

async function storageKeyOf(fileId: string): Promise<string> {
  const row = await queryOne<{ storage_key: string }>(
    'SELECT storage_key FROM files WHERE id = $1',
    [fileId],
  );
  if (!row) throw new Error(`no file row for ${fileId}`);
  return row.storage_key;
}

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

describe('deleting a file frees its storage bytes', () => {
  it('removes the object from the storage driver, not just the database row', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const { statusCode, body } = await uploadImage(owner.session);
    expect(statusCode).toBe(201);

    const key = await storageKeyOf(body.id);
    // The bytes exist before the delete — otherwise the assertion below would
    // pass vacuously.
    await expect(getStorage().get(key)).resolves.toBeInstanceOf(Buffer);

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${body.id}`,
      headers: auth(owner.session),
    });
    expect(response.statusCode).toBe(204);

    await expect(getStorage().get(key)).rejects.toThrow();
  });

  it('404s a second delete rather than touching storage again for a key that may have been reused', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const { body } = await uploadImage(owner.session);

    const first = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${body.id}`,
      headers: auth(owner.session),
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${body.id}`,
      headers: auth(owner.session),
    });
    expect(second.statusCode).toBe(404);
  });

  it('refuses to delete a file that belongs to someone else', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const stranger = await onboardedUser();
    const { body } = await uploadImage(owner.session);

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/files/${body.id}`,
      headers: auth(stranger.session),
    });
    expect(response.statusCode).toBe(404);

    // Untouched: still readable, by the owner, afterwards.
    const key = await storageKeyOf(body.id);
    await expect(getStorage().get(key)).resolves.toBeInstanceOf(Buffer);
  });
});
