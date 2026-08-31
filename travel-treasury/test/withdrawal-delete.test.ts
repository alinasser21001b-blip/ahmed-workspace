import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';
import { seedResearch, seedUsers } from '../src/server/db/seed.ts';

/**
 * Deleting a withdrawal means "this never happened" — a test entry, or the
 * wrong card picked. It is not a reversal, which says the bank gave the money
 * back and keeps both records. So it is allowed only while nothing downstream
 * has reasoned about the record, and it must return the cash wallet and the
 * card's expected balance to exactly where they were.
 */
let db: Db;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
let cardId = '';

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method, url,
    payload: (method === 'GET' || method === 'DELETE' ? undefined : (body ?? {})) as never,
    headers: {
      cookie, 'x-csrf-token': csrf,
      ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
    },
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

let n = 0;
async function makeWithdrawal() {
  n += 1;
  const r = await call('POST', '/v1/withdrawals', {
    idempotencyKey: `wdel-${n}`, cardId, dispensedSarMinor: '74600',
    transactionAt: `2026-09-0${n}T09:00:00Z`, dccOffered: 'NO',
    before: { amountMinor: '2600000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    after: { amountMinor: '2100000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
  });
  return r.json.id as string;
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seedResearch(db);
  await seedUsers(db, [{ email: 'w@t.iq', password: 'wdelete traveler pass', role: 'TRAVELER', displayName: 'W' }]);
  app = await buildApp({ db, secureCookies: false });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'w@t.iq', password: 'wdelete traveler pass' } });
  cookie = (login.headers['set-cookie'] as string).split(';')[0] as string;
  csrf = (login.json() as { csrfToken: string }).csrfToken;
  const card = await call('POST', '/v1/cards', {
    nickname: 'Qi Test', issuer: 'Rafidain Bank', product: 'Qi Card', network: 'MASTERCARD',
    cardType: 'PREPAID', last4: '3456', ownership: 'COMPANY', nativeCurrency: 'IQD',
    openingAvailableMinor: '2600000',
  });
  cardId = card.json.id as string;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('deleting a withdrawal that never happened', () => {
  it('removes the record, its cash movement and its balance snapshots', async () => {
    const id = await makeWithdrawal();
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM balance_snapshots WHERE card_id = $1`, [cardId]);
    expect(before.rows[0]!.n).toBe(2); // the before/after pair this withdrawal captured

    const del = await call('DELETE', `/v1/withdrawals/${id}`);
    expect(del.status).toBe(200);

    const w = await db.query(`SELECT id FROM withdrawals WHERE id = $1`, [id]);
    expect(w.rows).toHaveLength(0);
    const m = await db.query(`SELECT id FROM cash_movements WHERE withdrawal_id = $1`, [id]);
    expect(m.rows).toHaveLength(0);
    const s = await db.query(`SELECT id FROM balance_snapshots WHERE card_id = $1`, [cardId]);
    expect(s.rows).toHaveLength(0);
  });

  it('returns the company cash wallet to zero', async () => {
    const id = await makeWithdrawal();
    const dash = await call('GET', '/v1/dashboard');
    // The withdrawal credited cash; after deleting it, no movement remains.
    expect(dash.status).toBe(200);
    await call('DELETE', `/v1/withdrawals/${id}`);
    const moves = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM cash_movements`);
    expect(moves.rows[0]!.n).toBe(0);
  });

  it('leaves the deletion in the audit trail', async () => {
    const id = await makeWithdrawal();
    await call('DELETE', `/v1/withdrawals/${id}`);
    const ev = await db.query<{ previous_value: string | null }>(
      `SELECT previous_value::text AS previous_value FROM audit_events
        WHERE action = 'WITHDRAWAL_DELETED' AND entity_id = $1`,
      [id],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]!.previous_value).toContain('74600');
  });

  it('refuses once a pending debit has been recorded', async () => {
    const id = await makeWithdrawal();
    await call('POST', `/v1/withdrawals/${id}/pending`, { pendingDebitMinor: '500000' });
    const del = await call('DELETE', `/v1/withdrawals/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.error as string).toMatch(/state PENDING/);
    // The record survives the refusal intact.
    const w = await db.query(`SELECT id FROM withdrawals WHERE id = $1`, [id]);
    expect(w.rows).toHaveLength(1);
  });

  it('refuses once settled', async () => {
    const id = await makeWithdrawal();
    await call('POST', `/v1/withdrawals/${id}/settle`, { postedDebitMinor: '500000' });
    const del = await call('DELETE', `/v1/withdrawals/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.errorAr as string).toMatch(/عكس العملية/);
  });

  it('requires a CSRF token and a real withdrawal', async () => {
    const id = await makeWithdrawal();
    const noCsrf = await app.inject({ method: 'DELETE', url: `/v1/withdrawals/${id}`, headers: { cookie } });
    expect(noCsrf.statusCode).toBe(401);
    const missing = await call('DELETE', '/v1/withdrawals/wd_nope');
    expect(missing.status).toBe(404);
    await call('DELETE', `/v1/withdrawals/${id}`); // clean up
  });
});
