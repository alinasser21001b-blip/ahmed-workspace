import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';
import { seedResearch, seedUsers } from '../src/server/db/seed.ts';

/**
 * The stranded-client scenario seen in production: the session cookie outlives
 * the browser's storage, so the app is signed in but has no CSRF token. Every
 * write fails, and logout used to fail too — a loop with no exit. The client
 * must be able to rotate a fresh token with the cookie alone, after which the
 * old token is dead and writes work again.
 */
let db: Db;
let app: FastifyInstance;
let cookie = '';
let originalCsrf = '';

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seedResearch(db);
  await seedUsers(db, [{ email: 'c@t.iq', password: 'csrf traveler pass', role: 'TRAVELER', displayName: 'C' }]);
  app = await buildApp({ db, secureCookies: false });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'c@t.iq', password: 'csrf traveler pass' } });
  cookie = (login.headers['set-cookie'] as string).split(';')[0] as string;
  originalCsrf = (login.json() as { csrfToken: string }).csrfToken;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const cardPayload = (last4: string) => ({
  nickname: `Qi ${last4}`, issuer: 'Rafidain Bank', product: 'Qi Card', network: 'MASTERCARD',
  cardType: 'PREPAID', last4, ownership: 'PERSONAL', nativeCurrency: 'IQD',
  openingAvailableMinor: '1000000', internationalStatus: 'UNKNOWN',
});

describe('CSRF token restore after the browser drops storage', () => {
  it('a write with the cookie but no CSRF token is refused', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/cards', payload: cardPayload('1111'),
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toMatch(/CSRF/);
  });

  it('the cookie alone rotates a fresh token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/csrf', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { csrfToken } = res.json() as { csrfToken: string };
    expect(csrfToken).toBeTruthy();
    expect(csrfToken).not.toBe(originalCsrf);

    // The rotated token works for writes; the pre-rotation token is dead.
    const ok = await app.inject({
      method: 'POST', url: '/v1/cards', payload: cardPayload('2222'),
      headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { id: string }).id).toBeTruthy();
    const stale = await app.inject({
      method: 'POST', url: '/v1/cards', payload: cardPayload('3333'),
      headers: { cookie, 'x-csrf-token': originalCsrf, 'content-type': 'application/json' },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('rotation without a valid session is refused', async () => {
    const noCookie = await app.inject({ method: 'POST', url: '/v1/auth/csrf' });
    expect(noCookie.statusCode).toBe(401);
    const badCookie = await app.inject({ method: 'POST', url: '/v1/auth/csrf', headers: { cookie: 'tt_session=forged' } });
    expect(badCookie.statusCode).toBe(401);
  });

  it('logout needs only the cookie, so a stranded client can always escape', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});
