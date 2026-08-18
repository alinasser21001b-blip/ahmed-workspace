import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertResettableDatabaseUrl, assertTestDatabaseUrl } from './database-safety.js';
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

/**
 * Where the .sql files are.
 *
 * Derived from this module's own location, which is right in every case where
 * the module is where it was compiled to — and wrong in exactly one: a bundled
 * deployment, where the compiled output has been inlined somewhere else
 * entirely and the .sql files travel separately as data. A host in that
 * position sets this once at boot.
 *
 * It is module state rather than a parameter because `isSchemaCurrent` is
 * called by the readiness probe, which has no way to pass anything in — and a
 * readiness probe that answers "not ready" forever because it is counting files
 * in a directory that does not exist is a bad way to find this out.
 */
let migrationsDir = MIGRATIONS_DIR;

export function setMigrationsDir(dir: string): void {
  migrationsDir = dir;
}

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

export async function listMigrationFiles(dir = migrationsDir): Promise<string[]> {
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
  const dir = options.dir ?? migrationsDir;
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
 *
 * This is the DEVELOPER reset, reached through `pnpm db:reset`, and it
 * deliberately permits `_dev` and `_demo`: wiping your own development or
 * demo database is the entire point of the command. That permission is also
 * why it is the wrong guard for the test suite, which must never be able to
 * reach `_dev` at all — see `resetTestDatabase` below.
 *
 * The guard itself is `checkResettableDatabaseUrl` in database-safety.ts: the
 * database name (parsed, not matched as a substring of the whole connection
 * string) must end in a disposable suffix, and the host (also parsed) must be
 * private. See that module for why the previous single-regex check was unsafe.
 */
export async function resetDatabase(): Promise<void> {
  assertResettableDatabaseUrl(process.env.DATABASE_URL, 'resetDatabase');
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

/**
 * Drops and recreates the public schema for the integration suite.
 *
 * The same destruction as `resetDatabase`, behind the much narrower
 * test-database contract: the name must end in `_test` and the host must be
 * private. Development databases are refused by name.
 *
 * This exists as a second, independent check rather than as a comment on the
 * first. The global setup already refuses an unsafe URL before it gets here,
 * but a guard that only runs one layer up is a guard that a future caller can
 * skip without noticing. Asserting again at the point of destruction is what
 * makes "tests cannot drop the dev database" a property of the code rather
 * than of the calling convention.
 */
export async function resetTestDatabase(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL, 'resetTestDatabase');
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
