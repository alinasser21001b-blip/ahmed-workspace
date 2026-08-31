import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The database port. Two implementations: PGlite (in-process Postgres) for
 * local development and tests, and node-postgres for a hosted Postgres in
 * production. Both speak the same SQL; the schema file is shared verbatim.
 *
 * Every financial write in the application goes through `transaction()`. The
 * repository layer exposes no way to write a monetary row outside one.
 */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

export function schemaSql(): string {
  return readFileSync(join(here, 'schema.sql'), 'utf8');
}

// ---------------------------------------------------------------- PGlite ----

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;

  const wrap = (q: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  }): Omit<Db, 'transaction' | 'close'> => ({
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await q.query(sql, params);
      return { rows: res.rows as R[] };
    },
  });

  const db: Db = {
    ...wrap(pg),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        const txDb: Db = {
          ...wrap(tx),
          transaction: async (inner) => inner(txDb), // nested joins the outer tx
          close: async () => {},
        };
        return fn(txDb);
      }) as Promise<T>;
    },
    async close() {
      await pg.close();
    },
  };
  return db;
}

// ------------------------------------------------------------------- pg ----

export async function createPostgresDb(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  // bigint columns arrive as strings; that is exactly what we want — they are
  // parsed into bigint at the edge, never through a JavaScript number.
  const pool = new pg.Pool({ connectionString, max: 5 });

  const db: Db = {
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return { rows: res.rows as R[] };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb: Db = {
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params);
            return { rows: res.rows as R[] };
          },
          transaction: async (inner) => inner(txDb),
          close: async () => {},
        };
        const out = await fn(txDb);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return db;
}

export async function migrate(db: Db): Promise<void> {
  // The schema is written to be idempotent (IF NOT EXISTS / OR REPLACE), so
  // migration is a single apply. PGlite cannot run multi-statement strings
  // through the extended protocol, so statements are split and run in order
  // inside one transaction.
  const sql = schemaSql();
  await db.transaction(async (tx) => {
    for (const stmt of splitSqlStatements(sql)) {
      await tx.query(stmt);
    }
  });
}

/**
 * Split on top-level semicolons, respecting $$ ... $$ function bodies,
 * single-quoted strings, and line comments (a semicolon inside a comment or a
 * string is text, not a statement boundary).
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let inDollar = false;
  let inString = false;
  let inComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string;
    if (inComment) {
      current += ch;
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (!inDollar && ch === '-' && sql[i + 1] === '-') {
      inComment = true;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDollar) {
      inString = true;
      current += ch;
      continue;
    }
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      current += '$$';
      i++;
      continue;
    }
    if (ch === ';' && !inDollar) {
      if (current.trim().length > 0) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) out.push(current.trim());
  // Drop statements that are nothing but comment lines.
  return out.filter((stmt) =>
    stmt.split('\n').some((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    }),
  );
}

export async function connectFromEnv(): Promise<Db> {
  const url = process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL;
  if (url) return createPostgresDb(url);
  return createPgliteDb(process.env.PGLITE_DIR);
}
