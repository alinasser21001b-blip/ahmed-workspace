import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';

/**
 * Migration runner.
 *
 * Plain numbered .sql files and about a hundred lines of runner, rather than a
 * migration framework. Three properties matter here and all three are cheap to
 * get right by hand:
 *
 *   * ADVISORY LOCK — two instances booting simultaneously must not both try
 *     to apply migration 0007. The lock makes concurrent deploys safe.
 *   * CHECKSUMS — an already-applied migration that has been edited is a
 *     hard error. Silent divergence between environments is the failure mode
 *     that costs a weekend.
 *   * TRANSACTIONAL — each migration applies inside its own transaction, so a
 *     failure leaves no half-applied schema.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Arbitrary but fixed: the key for pg_advisory_lock. */
const LOCK_KEY = 8_675_309;

export interface MigrationRecord {
  name: string;
  checksum: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    )
  `);
}

function checksum(contents: string): string {
  return createHash('sha256').update(contents).digest('hex').slice(0, 32);
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => {});
  const pool = getPool();

  await ensureMigrationsTable();

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    // Blocks until any concurrently-deploying instance finishes.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const { rows } = await client.query<MigrationRecord>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const already = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of await listMigrationFiles(dir)) {
      const sql = await readFile(join(dir, file), 'utf8');
      const sum = checksum(sql);
      const previous = already.get(file);

      if (previous !== undefined) {
        if (previous !== sum) {
          throw new Error(
            `Migration ${file} has changed since it was applied ` +
              `(recorded ${previous}, found ${sum}). Applied migrations are immutable — ` +
              `add a new migration instead of editing this one.`,
          );
        }
        skipped.push(file);
        continue;
      }

      const startedAt = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
          [file, sum, Date.now() - startedAt],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }

      applied.push(file);
      log(`applied ${file} (${Date.now() - startedAt}ms)`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }

  return { applied, skipped };
}

/**
 * Drops and recreates the public schema. Guarded so it can never run against a
 * production database — a reset command that can reach production is a matter
 * of time, not of care.
 */
export async function resetDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('resetDatabase refused: NODE_ENV is production');
  }
  if (!/_test|_dev|localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      'resetDatabase refused: DATABASE_URL does not look like a local dev or test database',
    );
  }
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

/** True when every migration file on disk has been applied. Used by /health/ready. */
export async function isSchemaCurrent(): Promise<boolean> {
  try {
    const files = await listMigrationFiles();
    const { rows } = await getPool().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM schema_migrations',
    );
    return (rows[0]?.count ?? 0) >= files.length;
  } catch {
    return false;
  }
}
