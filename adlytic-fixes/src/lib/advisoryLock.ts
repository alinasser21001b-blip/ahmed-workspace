// ════════════════════════════════════════════════════════════════════════
//  src/lib/advisoryLock.ts
//
//  Shared Postgres advisory-lock helpers. Used by syncAccount (per-account
//  locks) and serve.ts (coarse auto-sync pass lock) so multi-instance
//  Railway deploys don't duplicate background work.
//
//  IMPORTANT — session-scoped advisory locks MUST be acquired and released
//  on the SAME Postgres connection. Prisma's pooled adapter can check out
//  a different connection for unlock, which either leaves the lock stuck
//  on an idle session or silently fails to unlock. Production code paths
//  therefore hold the lock on a dedicated pg.Pool client for the entire
//  critical section via `withAdvisoryLock`.
// ════════════════════════════════════════════════════════════════════════

import type { PrismaClient } from '@prisma/client';
import type pg from 'pg';

/**
 * Stable 32-bit integer hash of a string — safe as a Postgres advisory lock key.
 * Advisory locks take a bigint; we keep it positive and under 2^31 to stay within
 * the signed 32-bit range that pg_try_advisory_lock accepts as an int4 pair.
 */
export function advisoryLockId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h >>> 1;
}

/** Pool used for connection-pinned advisory locks. Set once at process boot. */
let lockPool: pg.Pool | null = null;

/**
 * In-process fallback used by unit tests (and only as a last resort when the
 * pool was never registered). Multi-instance production safety REQUIRES
 * `setAdvisoryLockPool` at boot — this Set alone does not cross processes.
 */
const localLocks = new Set<string>();

/**
 * Register the process-wide pg.Pool used to pin advisory-lock connections.
 * Must be called from serve.ts / worker entrypoints before any sync runs.
 */
export function setAdvisoryLockPool(pool: pg.Pool): void {
  lockPool = pool;
}

export function getAdvisoryLockPool(): pg.Pool | null {
  return lockPool;
}

/**
 * Acquire a session-scoped advisory lock on a dedicated pool connection,
 * run `fn`, then unlock and release. Concurrent callers for the same key
 * receive `{ acquired: false }` without running `fn`.
 *
 * The lock is held on ONE connection for the whole critical section, so
 * Prisma's pooled queries inside `fn` cannot steal or orphan it.
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  if (!lockPool) {
    // Unit-test / misconfigured-boot fallback — single process only.
    if (localLocks.has(key)) return { acquired: false };
    localLocks.add(key);
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      localLocks.delete(key);
    }
  }
  const lockId = advisoryLockId(key);
  const client = await lockPool.connect();
  try {
    const res = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [lockId],
    );
    if (!res.rows[0]?.pg_try_advisory_lock) {
      return { acquired: false };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch (err) {
        console.warn(`[advisoryLock] unlock failed for key=${key.slice(0, 12)}:`, err);
      }
    }
  } finally {
    client.release();
  }
}

/** Non-blocking advisory lock acquire. Returns false when another session holds it.
 *  @deprecated Prefer withAdvisoryLock — pooled Prisma unlock is unreliable. */
export async function tryAcquireAdvisoryLock(
  prisma: PrismaClient,
  key: string,
): Promise<{ acquired: boolean; lockId: number }> {
  // Prefer the dedicated pool when available so acquire/release stay paired.
  if (lockPool) {
    // Legacy API cannot hold the connection — callers of this helper that
    // still use releaseAdvisoryLock via Prisma are the scheduler pass lock,
    // which we migrate separately. Fall through to Prisma for back-compat
    // of the short-lived scheduler lock only when withAdvisoryLock isn't used.
  }
  const lockId = advisoryLockId(key);
  const [{ pg_try_advisory_lock: acquired }] = await prisma.$queryRawUnsafe<
    [{ pg_try_advisory_lock: boolean }]
  >(`SELECT pg_try_advisory_lock($1)`, lockId);
  return { acquired, lockId };
}

/** Release a session-scoped advisory lock acquired via tryAcquireAdvisoryLock.
 *  @deprecated Prefer withAdvisoryLock. */
export async function releaseAdvisoryLock(prisma: PrismaClient, lockId: number): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockId);
}
