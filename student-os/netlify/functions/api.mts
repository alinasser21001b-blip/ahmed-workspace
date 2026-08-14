import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';

/**
 * The built server, typed from the thing itself.
 *
 * Written this way rather than as `import type { FastifyInstance } from 'fastify'`
 * because Fastify is a dependency of `apps/api`, not of the deployment glue —
 * and reaching for it here would be this file quietly acquiring an opinion
 * about the server's internals.
 */
type App = Awaited<ReturnType<typeof import('../../apps/api/dist/http/app.js').buildApp>>;

/**
 * The API, running as one Netlify function.
 *
 * The product's server is a long-lived Fastify process (`apps/api`). Nothing
 * about it is rewritten here: this file is an adapter, and the deployed API is
 * the same code, the same routes and the same authorization layer that `pnpm
 * dev` and the test suite exercise. A second implementation of any of that
 * would be a second thing to keep correct, which is exactly what ADR-0003 says
 * not to do.
 *
 * Requests are handed to Fastify through `inject()` rather than over a socket.
 * That is Fastify's own in-process entry point — the same one the integration
 * tests use — so routing, hooks, validation, serialisation and the error
 * handler all run normally; only the TCP layer is absent, and on this platform
 * there is no TCP layer to have.
 *
 * WHAT DOES NOT WORK HERE, and is not made to look like it does: the realtime
 * WebSocket at `/v1/realtime`. A function is invoked per request and cannot
 * hold a connection open, so the upgrade fails, the client's backoff takes over
 * and messaging falls back to its HTTP path — messages send and load, they just
 * do not arrive by themselves. Fixing that means a host that can hold a socket,
 * not a change to this file.
 */

/** Where `included_files` puts the migration SQL, depending on the runtime. */
const MIGRATION_DIR_CANDIDATES = [
  process.env.LAMBDA_TASK_ROOT,
  process.cwd(),
  '/var/task',
].filter((base): base is string => typeof base === 'string' && base.length > 0);

function findMigrationsDir(): string {
  for (const base of MIGRATION_DIR_CANDIDATES) {
    const candidate = join(base, 'apps/api/migrations');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find apps/api/migrations. Looked under: ${MIGRATION_DIR_CANDIDATES.join(', ')}. ` +
      'Check `included_files` in netlify.toml.',
  );
}

/**
 * Object storage, backed by Netlify Blobs.
 *
 * The API is configured with `STORAGE_DRIVER=external` and this is what it gets.
 * Doing it here rather than inside `apps/api` keeps the server package free of
 * any dependency on the platform it happens to be deployed to — the same reason
 * the S3 driver is a driver and not an `if` in the upload route.
 */
function netlifyBlobsDriver() {
  // Opened on first use rather than at boot. `getStore` needs the platform's
  // blob credentials in the environment, and a deploy where nobody has uploaded
  // anything yet should not fail to serve its first page over it.
  let store: ReturnType<typeof getStore> | null = null;
  const uploads = (): ReturnType<typeof getStore> =>
    (store ??= getStore({ name: 'sos-uploads', consistency: 'strong' }));

  return {
    name: 'netlify-blobs',
    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      // Copied into a standalone ArrayBuffer: a Buffer is a view onto a pooled
      // allocation, so handing over its backing store would hand over its
      // neighbours too.
      const bytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      await uploads().set(key, bytes as ArrayBuffer, { metadata: { contentType } });
    },
    async get(key: string): Promise<Buffer> {
      const value = await uploads().get(key, { type: 'arrayBuffer' });
      // The callers of `get` treat a throw as "missing"; returning an empty
      // buffer instead would serve zero bytes as though they were the file.
      if (value === null) throw new Error(`blob not found: ${key}`);
      return Buffer.from(value);
    },
    async delete(key: string): Promise<void> {
      await uploads().delete(key);
    },
  };
}

/**
 * One-time boot for this instance.
 *
 * Migrations run here rather than as a deploy step because a function has no
 * deploy step to hook: there is no release command that runs once with the
 * database in reach. It is safe to do it per instance — the migrator takes a
 * Postgres advisory lock and records what it applied, so concurrent cold starts
 * serialise and a repeat run is a no-op. Each migration also commits on its
 * own, so if a cold start is cut short by the invocation timeout, the next one
 * resumes where it stopped instead of starting over.
 */
async function boot(): Promise<App> {
  // `@netlify/database` resolves to this deploy's branch of the database, so a
  // deploy preview gets its own copy rather than writing to the live one.
  if (!process.env.DATABASE_URL) {
    const { getConnectionString } = await import('@netlify/database');
    process.env.DATABASE_URL = getConnectionString();
  }

  const { setStorage } = await import('../../apps/api/dist/platform/storage.js');
  setStorage(netlifyBlobsDriver());

  // Set rather than passed: the readiness probe counts the same files and has
  // no argument to pass them through, so this has to be the module's answer and
  // not just this call's.
  const { migrate, setMigrationsDir } = await import('../../apps/api/dist/platform/migrate.js');
  setMigrationsDir(findMigrationsDir());
  await migrate();

  // Signup asks a student which course they are on. An empty database has no
  // courses, so without this the deployed app has no way in. Upserts, so it
  // costs one transaction per cold start and changes nothing after the first.
  const { seedAcademicHierarchy } = await import(
    '../../apps/api/dist/modules/academic/academic.seed.js'
  );
  await seedAcademicHierarchy();

  await ensureAdministrator();

  const { buildApp } = await import('../../apps/api/dist/http/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * The first administrator, for a host with no shell.
 *
 * `pnpm --filter @sos/api admin:bootstrap` assumes someone with a terminal and
 * a database connection string. Neither exists here, and a deployment with
 * nobody who can administer it cannot verify an instructor, which means it
 * cannot have a classroom, which means most of the product is unreachable.
 *
 * Both variables are required together, and the whole thing is skipped when
 * either is missing — so a deployment that says nothing about an administrator
 * gets no administrator, rather than a default one.
 */
async function ensureAdministrator(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const { ensureBootstrapAdmin } = await import(
    '../../apps/api/dist/modules/admin/admin.bootstrap.js'
  );
  const result = await ensureBootstrapAdmin({ email, password });
  // One line, on the boot path, so the deploy log says which account was made
  // and whether this run is the one that made it. Never the password.
  console.log(
    `[bootstrap] ${result.email} is a platform administrator ` +
      `(created=${result.created}, alreadyAdmin=${result.wasAlreadyAdmin})`,
  );
}

let booting: Promise<App> | null = null;

function getApp(): Promise<App> {
  // Cleared on failure so a transient database problem during boot does not
  // poison this instance for the rest of its life.
  booting ??= boot().catch((error: unknown) => {
    booting = null;
    throw error;
  });
  return booting;
}

/** Fastify reports headers in Node's shape; `Response` wants a `Headers`. */
function toHeaders(source: Record<string, number | string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    // Recomputed by the runtime from the body we hand back; passing the
    // injected values through can contradict it.
    if (name === 'content-length' || name === 'transfer-encoding') continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, String(value));
  }
  return headers;
}

/**
 * Strips anything that should not travel to a browser.
 *
 * The reason below is deliberately shown to the caller, because a deployment
 * that fails at boot is otherwise completely opaque from the outside — which is
 * how a broken sign-in stayed unexplained for two rounds. Database errors do
 * not normally carry the connection string, but "do not normally" is not a
 * guarantee worth relying on when the audience is the public internet.
 */
function redactSecrets(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://[redacted]');
}

/**
 * The API's own error envelope, for failures that never reached the API.
 *
 * Without this, a throw in `boot` becomes the platform's HTML error page. The
 * client cannot parse that into anything it recognises, so it falls back to
 * "we could not complete that" — a sentence that describes every possible
 * failure and identifies none of them. An adapter should never let the
 * platform's error page stand in for the API's.
 */
function bootFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[boot] the API failed to start', error);
  return new Response(
    JSON.stringify({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `The API failed to start: ${redactSecrets(message)}`,
      },
    }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

export default async function handler(request: Request): Promise<Response> {
  let app: App;
  try {
    app = await getApp();
  } catch (error) {
    return bootFailure(error);
  }

  const url = new URL(request.url);

  /*
   * Two things can route a request here: this function's own `path` config,
   * which preserves the URL, and the explicit rewrite in netlify.toml, which
   * can arrive as `/.netlify/functions/api/v1/...`. Fastify only knows the
   * first shape, so the second is normalised back to it — otherwise every
   * route 404s depending on which mechanism matched, which is a very confusing
   * thing to debug from the outside.
   */
  const FUNCTION_PREFIX = '/.netlify/functions/api';
  const pathname = url.pathname.startsWith(FUNCTION_PREFIX)
    ? url.pathname.slice(FUNCTION_PREFIX.length) || '/'
    : url.pathname;

  const method = request.method.toUpperCase();
  const payload =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer());

  const response = await app.inject({
    method: method as 'GET',
    url: pathname + url.search,
    headers: Object.fromEntries(request.headers),
    payload,
    // Fastify is configured with `trustProxy`, so the rate limiter and the logs
    // see the real client rather than the platform's edge.
    remoteAddress: request.headers.get('x-nf-client-connection-ip') ?? '127.0.0.1',
  });

  // `Uint8Array`, not the Buffer itself: `BodyInit` is the web type, and Node's
  // Buffer only satisfies it by accident of being a view.
  const body = method === 'HEAD' ? null : new Uint8Array(response.rawPayload);

  return new Response(body, {
    status: response.statusCode,
    headers: toHeaders(response.headers),
  });
}

/**
 * Everything the API serves, and nothing else — the static client is served by
 * the CDN from `publish`, and a catch-all here would put every page load
 * through a cold start.
 */
export const config: Config = {
  path: ['/v1/*', '/health', '/health/*'],
};
