import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';
import { seedResearch, seedUsers } from '../src/server/db/seed.ts';

/**
 * Deleting a card must never be able to destroy financial history. A card that
 * carried nothing can go; a card with a withdrawal, a balance snapshot or a
 * funding event is archived instead, and the refusal says which. Archiving
 * keeps every record readable while removing the card from active use.
 */
let db: Db;
let app: FastifyInstance;
let cookie = '';
let csrf = '';

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: (method === 'GET' || method === 'DELETE' ? undefined : (body ?? {})) as never,
    headers: {
      cookie,
      'x-csrf-token': csrf,
      ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
    },
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

const card = (last4: string, extra: Record<string, unknown> = {}) => ({
  nickname: `Card ${last4}`, issuer: 'NEO Iraq', product: 'NEO 964', network: 'VISA',
  cardType: 'PREPAID', last4, ownership: 'PERSONAL', nativeCurrency: 'IQD',
  openingAvailableMinor: '5000000', ...extra,
});

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seedResearch(db);
  await seedUsers(db, [{ email: 'd@t.iq', password: 'delete traveler pass', role: 'TRAVELER', displayName: 'D' }]);
  app = await buildApp({ db, secureCookies: false });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'd@t.iq', password: 'delete traveler pass' } });
  cookie = (login.headers['set-cookie'] as string).split(';')[0] as string;
  csrf = (login.json() as { csrfToken: string }).csrfToken;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('deleting a card', () => {
  it('removes a card that never carried money', async () => {
    const made = await call('POST', '/v1/cards', card('4001'));
    const id = made.json.id as string;
    const del = await call('DELETE', `/v1/cards/${id}`);
    expect(del.status).toBe(200);
    const list = await call('GET', '/v1/cards');
    expect((list.json.cards as { id: string }[]).some((c) => c.id === id)).toBe(false);
  });

  it('leaves the deletion in the audit trail', async () => {
    const made = await call('POST', '/v1/cards', card('4002'));
    const id = made.json.id as string;
    await call('DELETE', `/v1/cards/${id}`);
    const events = await db.query<{ action: string; entity_id: string; previous_value: string | null }>(
      `SELECT action, entity_id, previous_value::text AS previous_value
         FROM audit_events WHERE action = 'CARD_DELETED' AND entity_id = $1`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    // The row that existed is preserved, so the deletion is not untraceable.
    expect(events.rows[0]!.previous_value).toContain('4002');
  });

  it('refuses a card holding a withdrawal, naming what holds it', async () => {
    const made = await call('POST', '/v1/cards', card('4003'));
    const id = made.json.id as string;
    await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'del-w1', cardId: id, dispensedSarMinor: '100000',
      transactionAt: '2026-09-05T09:00:00Z', dccOffered: 'NO',
      before: { amountMinor: '5000000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '4612000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });

    const del = await call('DELETE', `/v1/cards/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.error as string).toMatch(/withdrawal/);
    expect(del.json.errorAr as string).toMatch(/سحب/);

    // The card and its withdrawal both survive the refused delete.
    const list = await call('GET', '/v1/cards');
    expect((list.json.cards as { id: string }[]).some((c) => c.id === id)).toBe(true);
    const wd = await db.query(`SELECT id FROM withdrawals WHERE card_id = $1`, [id]);
    expect(wd.rows).toHaveLength(1);
  });

  it('refuses a card holding only a balance snapshot', async () => {
    const made = await call('POST', '/v1/cards', card('4004'));
    const id = made.json.id as string;
    await call('POST', `/v1/cards/${id}/snapshots`, {
      amountMinor: '4000000', source: 'BANK_APP', balanceType: 'AVAILABLE',
    });
    const del = await call('DELETE', `/v1/cards/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.error as string).toMatch(/snapshot/);
  });

  it('refuses a card holding only a funding event', async () => {
    const made = await call('POST', '/v1/cards', card('4005', { nativeCurrency: 'USD', openingAvailableMinor: '300000' }));
    const id = made.json.id as string;
    await call('POST', `/v1/cards/${id}/funding`, {
      creditedMinor: '300000', iqdPaidMinor: '3990000', source: 'RECEIPT',
    });
    const del = await call('DELETE', `/v1/cards/${id}`);
    expect(del.status).toBe(409);
    expect(del.json.error as string).toMatch(/funding/);
  });

  it('archives a card with history instead, keeping its records', async () => {
    const made = await call('POST', '/v1/cards', card('4006'));
    const id = made.json.id as string;
    await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'del-w2', cardId: id, dispensedSarMinor: '50000',
      transactionAt: '2026-09-06T09:00:00Z', dccOffered: 'NO',
      before: { amountMinor: '5000000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '4806000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });

    const archived = await call('PATCH', `/v1/cards/${id}`, { isActive: false });
    expect(archived.status).toBe(200);

    // Still listed (flagged inactive) and its withdrawal is still readable.
    const list = await call('GET', '/v1/cards');
    const row = (list.json.cards as { id: string; is_active: boolean }[]).find((c) => c.id === id);
    expect(row?.is_active).toBe(false);
    const wd = await db.query(`SELECT id FROM withdrawals WHERE card_id = $1`, [id]);
    expect(wd.rows).toHaveLength(1);

    // An archived card takes no new withdrawals, and can be brought back.
    const blocked = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'del-w3', cardId: id, dispensedSarMinor: '10000',
      transactionAt: '2026-09-07T09:00:00Z', dccOffered: 'NO',
      before: { amountMinor: '4806000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '4767000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });
    expect(blocked.status).toBe(400);
    const back = await call('PATCH', `/v1/cards/${id}`, { isActive: true });
    expect(back.status).toBe(200);
  });

  it('requires a CSRF token and a real card', async () => {
    const made = await call('POST', '/v1/cards', card('4007'));
    const id = made.json.id as string;
    const noCsrf = await app.inject({ method: 'DELETE', url: `/v1/cards/${id}`, headers: { cookie } });
    expect(noCsrf.statusCode).toBe(401);
    const missing = await call('DELETE', '/v1/cards/card_does_not_exist');
    expect(missing.status).toBe(404);
  });
});
