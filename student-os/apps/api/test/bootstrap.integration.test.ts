import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureBootstrapAdmin } from '../src/modules/admin/admin.bootstrap.js';
import { queryOne } from '../src/platform/db.js';
import { closeApp, getApp, uniqueEmail } from './helpers.js';

/**
 * The first administrator on a host with no shell.
 *
 * This is the one path that creates a privileged account without a privileged
 * caller, so its edges are the interesting part rather than its happy case:
 * it must not reset a password it did not set, it must not accept a weak one,
 * and running it twice must not produce two of anything.
 */

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

const PASSWORD = 'a-long-enough-bootstrap-password';

async function roleOf(email: string): Promise<string | null> {
  const row = await queryOne<{ role: string }>(
    `SELECT role FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email],
  );
  return row?.role ?? null;
}

describe('ensureBootstrapAdmin', () => {
  it('creates the named account and makes it an administrator', async () => {
    const email = uniqueEmail('bootstrap');
    const result = await ensureBootstrapAdmin({ email, password: PASSWORD });

    expect(result.created).toBe(true);
    expect(result.wasAlreadyAdmin).toBe(false);
    expect(await roleOf(email)).toBe('admin');
  });

  it('is idempotent — a second run changes nothing', async () => {
    const email = uniqueEmail('bootstrap');
    const first = await ensureBootstrapAdmin({ email, password: PASSWORD });
    const second = await ensureBootstrapAdmin({ email, password: PASSWORD });

    expect(second.created).toBe(false);
    expect(second.wasAlreadyAdmin).toBe(true);
    expect(second.userId).toBe(first.userId);

    const { count } = (await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE lower(email) = lower($1)`,
      [email],
    ))!;
    expect(count).toBe(1);
  });

  it('promotes an account that already exists rather than replacing it', async () => {
    const email = uniqueEmail('bootstrap');
    await ensureBootstrapAdmin({ email, password: PASSWORD });
    const before = (await queryOne<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE lower(email) = lower($1)`,
      [email],
    ))!;

    // A restart with a different configured password must not take the account
    // away from whoever owns it now.
    await ensureBootstrapAdmin({ email, password: 'a-completely-different-password' });

    const after = (await queryOne<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE lower(email) = lower($1)`,
      [email],
    ))!;
    expect(after.id).toBe(before.id);
    expect(after.password_hash).toBe(before.password_hash);
  });

  it('grants no academic authority — teaching still goes through the audited endpoint', async () => {
    const email = uniqueEmail('bootstrap');
    await ensureBootstrapAdmin({ email, password: PASSWORD });

    const row = (await queryOne<{ verification_level: string }>(
      `SELECT verification_level FROM users WHERE lower(email) = lower($1)`,
      [email],
    ))!;
    expect(row.verification_level).toBe('unverified');
  });

  it('records the promotion in the audit log with no acting user', async () => {
    const email = uniqueEmail('bootstrap');
    const result = await ensureBootstrapAdmin({ email, password: PASSWORD });

    const entry = await queryOne<{ actor_id: string | null; action: string }>(
      `SELECT actor_id, action FROM audit_log
       WHERE target_id = $1 AND action = 'user.role.set'`,
      [result.userId],
    );
    expect(entry).not.toBeNull();
    expect(entry!.actor_id).toBeNull();
  });

  it('refuses a password too short to be an administrator credential', async () => {
    await expect(
      ensureBootstrapAdmin({ email: uniqueEmail('bootstrap'), password: 'short' }),
    ).rejects.toThrow(/at least 12 characters/i);
  });

  it('refuses something that is not an address', async () => {
    await expect(
      ensureBootstrapAdmin({ email: 'not-an-address', password: PASSWORD }),
    ).rejects.toThrow(/not an address/i);
  });
});
