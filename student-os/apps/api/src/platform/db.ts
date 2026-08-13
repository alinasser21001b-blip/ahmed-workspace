import pg from 'pg';
import { getConfig } from './config.js';
import { getLogger } from './logger.js';

/**
 * Database access.
 *
 * Hand-written SQL behind repository functions, not an ORM. The queries that
 * matter in this product — feed ranking, permission-filtered lists — are
 * exactly the ones an ORM obscures, and a leaked permission filter is not a
 * bug anyone wants hidden behind a query builder.
 *
 * Everything here is parameterised. There is no string interpolation of user
 * input anywhere in the repository layer, and that is enforced by review.
 */

const { Pool } = pg;

/**
 * Return numeric Postgres types as JavaScript numbers where safe, and as
 * strings where they can exceed Number.MAX_SAFE_INTEGER (bigint, numeric).
 * The default `pg` behaviour of returning int8 as a string surprises people;
 * being explicit about which types we convert is safer than either extreme.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
});

export type Sql = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const { env } = getConfig();

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'sos-api',
  });

  pool.on('error', (error) => {
    // An idle client erroring is not tied to a request, so it has no request
    // logger to attach to; log it on the root logger or it disappears.
    getLogger().error({ err: error }, 'idle database client error');
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Sql = getPool(),
): Promise<pg.QueryResult<R>> {
  return client.query<R>(sql, params as unknown[]);
}

export async function queryRows<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Sql = getPool(),
): Promise<R[]> {
  const result = await query<R>(sql, params, client);
  return result.rows;
}

export async function queryOne<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Sql = getPool(),
): Promise<R | null> {
  const result = await query<R>(sql, params, client);
  return result.rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Multi-table writes go through this without exception. The denormalised
 * counters on `content_items` are only trustworthy because the row insert and
 * the counter bump happen in the same transaction.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  existing?: pg.PoolClient,
): Promise<T> {
  // Support nesting by reusing an outer transaction's client rather than
  // opening a second connection that would deadlock against it.
  if (existing) return fn(existing);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      getLogger().error({ err: rollbackError }, 'rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function isHealthy(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
