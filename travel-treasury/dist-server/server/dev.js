import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from "./app.js";
import { connectFromEnv, migrate } from "./db/db.js";
import { seedResearch, seedUsers } from "./db/seed.js";
/**
 * Local runner: PGlite on disk (./.pgdata) unless DATABASE_URL points at a
 * hosted Postgres. Seeds the research registry and, in development only, two
 * known accounts.
 */
const db = await connectFromEnv();
await migrate(db);
await seedResearch(db);
if (process.env.NODE_ENV !== 'production') {
    await seedUsers(db, [
        { email: 'traveler@local', password: 'traveler-dev-password', role: 'TRAVELER', displayName: 'أحمد' },
        { email: 'admin@local', password: 'admin-dev-password', role: 'ADMIN', displayName: 'المشرف' },
    ]);
    console.log('[dev] users: traveler@local / traveler-dev-password, admin@local / admin-dev-password');
}
const app = await buildApp({ db, secureCookies: false });
// Serve the built PWA when present (npm run build:web), same-origin.
const dist = join(process.cwd(), 'dist');
if (existsSync(join(dist, 'index.html'))) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler(async (req, reply) => {
        if (req.raw.url?.startsWith('/v1/')) {
            reply.status(404).send({ error: 'Not found' });
            return;
        }
        return reply.sendFile('index.html');
    });
}
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: '0.0.0.0' });
console.log(`[dev] listening on http://localhost:${port}`);
