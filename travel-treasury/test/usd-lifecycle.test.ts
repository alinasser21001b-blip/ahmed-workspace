import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';
import { seedResearch, seedUsers } from '../src/server/db/seed.ts';

/**
 * The NEO USD card, end to end through the HTTP surface: the system must
 * refuse a dinar cost until funding evidence exists, then produce the exact
 * economic rate once it does.
 */
let db: Db;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
let cardId = '';
let wdId = '';

async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: (method === 'GET' ? undefined : (body ?? {})) as never,
    headers: { cookie, 'x-csrf-token': csrf, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
  });
  return { status: res.statusCode, json: res.json() as Record<string, never> };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seedResearch(db);
  await seedUsers(db, [{ email: 'u@t.iq', password: 'usd traveler pass', role: 'TRAVELER', displayName: 'U' }]);
  app = await buildApp({ db, secureCookies: false });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'u@t.iq', password: 'usd traveler pass' } });
  cookie = (login.headers['set-cookie'] as string).split(';')[0] as string;
  csrf = (login.json() as { csrfToken: string }).csrfToken;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('NEO Platinum (USD) lifecycle', () => {
  it('creates the USD card', async () => {
    const r = await call('POST', '/v1/cards', {
      nickname: 'NEO Platinum', issuer: 'NEO Iraq', product: 'NEO Platinum', network: 'VISA',
      cardType: 'PREPAID', last4: '9014', ownership: 'PERSONAL', nativeCurrency: 'USD',
      openingAvailableMinor: '300000', internationalStatus: 'CONFIRMED_WORKING',
    });
    cardId = r.json.id;
    expect(cardId).toBeTruthy();
  });

  it('withdraws 1,000 SAR: native cost 270 USD observed, dinar cost refused', async () => {
    const w = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'usd-w1', cardId, dispensedSarMinor: '100000',
      transactionAt: '2026-09-05T09:00:00Z', dccOffered: 'YES', dccSelection: 'LOCAL_CURRENCY',
      before: { amountMinor: '300000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '273000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });
    wdId = w.json.id;
    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    const c = d.json.computation as Record<string, { known: boolean; display?: string; reason?: string; code?: string }>;
    expect(c.nativeAllInCost!.display).toBe('270.00');
    expect(c.economicIqdCost!.known).toBe(false);
    expect(c.economicIqdCost!.code).toBe('NEED_FUNDING_BASIS');
    expect(c.verifiedIqdPerSar!.known).toBe(false);
  });

  it('after recording funding (3,990,000 IQD for 3,000 USD) the economic rate appears exactly', async () => {
    const f = await call('POST', `/v1/cards/${cardId}/funding`, {
      creditedMinor: '300000', iqdPaidMinor: '3990000', source: 'RECEIPT',
    });
    expect(f.status).toBe(200);
    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    const c = d.json.computation as Record<string, { known: boolean; display?: string }>;
    // 1,330 IQD per USD funding basis; 270 USD => 359,100 IQD; /1000 SAR = 359.10
    expect(c.economicIqdCost!.known).toBe(true);
    expect(c.economicIqdCost!.display).toBe('359100');
    expect(c.verifiedIqdPerSar!.known).toBe(true);
    expect(c.verifiedIqdPerSar!.display).toBe('359.1000');
  });

  it('settles and reconciles, and the comparison marks it comparable in IQD', async () => {
    await call('POST', `/v1/withdrawals/${wdId}/settle`, { postedDebitMinor: '27000' });
    const r = await call('POST', `/v1/withdrawals/${wdId}/reconcile`);
    expect(r.json.state).toBe('RECONCILED');
    const comp = await call('GET', '/v1/comparison');
    const row = (comp.json.rows as { nickname: string; comparableInIqd: boolean; rollingAverageIqdPerSar: string | null }[]).find(
      (x) => x.nickname === 'NEO Platinum',
    );
    expect(row?.comparableInIqd).toBe(true);
    expect(row?.rollingAverageIqdPerSar).toBe('359.10');
  });
});
