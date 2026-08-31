import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { connectFromEnv, migrate } from './db/db.ts';
import { seedResearch, seedUsers } from './db/seed.ts';

/**
 * Production entry. Requires a real Postgres via DATABASE_URL (PGlite on a
 * persistent disk works for a single-instance private deployment; set
 * PGLITE_DIR instead). First boot bootstraps the two accounts from environment
 * variables and refuses to run without them if no user exists yet.
 */
const db = await connectFromEnv();
await migrate(db);
await seedResearch(db);

const userCount = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
if ((userCount.rows[0]?.n ?? 0) === 0) {
  const travelerEmail = process.env.BOOTSTRAP_TRAVELER_EMAIL;
  const travelerPassword = process.env.BOOTSTRAP_TRAVELER_PASSWORD;
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!travelerEmail || !travelerPassword || !adminEmail || !adminPassword) {
    console.error(
      'No users exist and bootstrap variables are missing. Set BOOTSTRAP_TRAVELER_EMAIL, ' +
        'BOOTSTRAP_TRAVELER_PASSWORD, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD for first boot.',
    );
    process.exit(1);
  }
  if (travelerPassword.length < 12 || adminPassword.length < 12) {
    console.error('Bootstrap passwords must be at least 12 characters.');
    process.exit(1);
  }
  await seedUsers(db, [
    { email: travelerEmail, password: travelerPassword, role: 'TRAVELER', displayName: 'المسافر' },
    { email: adminEmail, password: adminPassword, role: 'ADMIN', displayName: 'المشرف' },
  ]);
  console.log('[prod] bootstrapped traveler and admin accounts');
}

const app = await buildApp({ db, secureCookies: true, trustProxy: true });

const dist = join(process.cwd(), 'dist');
if (existsSync(join(dist, 'index.html'))) {
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, {
    root: dist,
    wildcard: false,
    maxAge: '1h',
    immutable: false,
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/v1/')) {
      reply.status(404).send({ error: 'Not found' });
      return;
    }
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
console.log(`[prod] listening on :${port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => db.close()).then(() => process.exit(0));
  });
}
