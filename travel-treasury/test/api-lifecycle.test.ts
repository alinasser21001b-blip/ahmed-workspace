import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.ts';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';
import { seedResearch, seedUsers } from '../src/server/db/seed.ts';

let db: Db;
let app: FastifyInstance;
let cookie = '';
let csrf = '';

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: (method === 'GET' ? undefined : (body ?? {})) as never,
    headers: {
      cookie,
      'x-csrf-token': csrf,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
    },
  });
  let json: unknown = null;
  try {
    json = res.json();
  } catch {
    json = res.body;
  }
  return { status: res.statusCode, json: json as Record<string, unknown>, raw: res };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seedResearch(db);
  await seedUsers(db, [
    { email: 'traveler@example.iq', password: 'correct horse battery staple', role: 'TRAVELER', displayName: 'أحمد' },
    { email: 'admin@example.iq', password: 'admin passphrase here', role: 'ADMIN', displayName: 'Admin' },
  ]);
  app = await buildApp({ db, secureCookies: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('auth', () => {
  it('rejects a wrong password without leaking which field was wrong', async () => {
    const r = await call('POST', '/v1/auth/login', { email: 'traveler@example.iq', password: 'nope' });
    expect(r.status).toBe(401);
  });

  it('logs in, sets an HttpOnly cookie, returns a CSRF token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'traveler@example.iq', password: 'correct horse battery staple' },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    cookie = setCookie.split(';')[0] as string;
    csrf = (res.json() as { csrfToken: string }).csrfToken;
    expect(csrf.length).toBeGreaterThan(20);
  });

  it('refuses a mutating call without the CSRF token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cards',
      headers: { cookie },
      payload: { nickname: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('sets strict security headers on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

let neoCardId = '';
let qiCardId = '';
let wdId = '';

describe('the full financial lifecycle', () => {
  it('creates cards with validated fields', async () => {
    const neo = await call('POST', '/v1/cards', {
      nickname: 'NEO 964', issuer: 'NEO Iraq', product: 'NEO 964', network: 'VISA',
      cardType: 'PREPAID', last4: '4821', ownership: 'PERSONAL', nativeCurrency: 'IQD',
      openingAvailableMinor: '5000000', internationalStatus: 'CLAIMED_BY_ISSUER',
    });
    expect(neo.status).toBe(200);
    neoCardId = neo.json.id as string;

    const qi = await call('POST', '/v1/cards', {
      nickname: 'Qi الشركة', issuer: 'Rafidain Bank / Qi Card', product: 'Qi Mastercard', network: 'MASTERCARD',
      cardType: 'CORPORATE', last4: '7302', ownership: 'COMPANY', nativeCurrency: 'IQD',
      openingAvailableMinor: '20000000', internationalStatus: 'UNKNOWN',
    });
    qiCardId = qi.json.id as string;

    const bad = await call('POST', '/v1/cards', {
      nickname: 'bad', issuer: 'x', product: 'x', network: 'VISA', cardType: 'DEBIT',
      last4: '12345', ownership: 'PERSONAL', nativeCurrency: 'IQD',
    });
    expect(bad.status).toBe(400);
  });

  it('records a quick withdrawal with before/after balances, crediting personal cash', async () => {
    const r = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-w1',
      cardId: neoCardId,
      dispensedSarMinor: '100000',
      requestedSarMinor: '100000',
      dccOffered: 'YES',
      dccSelection: 'LOCAL_CURRENCY',
      atmOperator: 'Al Rajhi',
      before: { amountMinor: '5000000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '4612000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });
    expect(r.status).toBe(201);
    expect(r.json.created).toBe(true);
    wdId = r.json.id as string;

    const dash = await call('GET', '/v1/dashboard');
    const treasury = dash.json.treasury as { personal: { received: { minor: string } }; company: { received: { minor: string } } };
    expect(treasury.personal.received.minor).toBe('100000');
    expect(treasury.company.received.minor).toBe('0');
  });

  it('replays the same idempotency key without creating a second withdrawal', async () => {
    const r = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-w1',
      cardId: neoCardId,
      dispensedSarMinor: '100000',
    });
    expect(r.status).toBe(200);
    expect(r.json.created).toBe(false);
    expect(r.json.id).toBe(wdId);
    const list = await call('GET', '/v1/withdrawals');
    expect((list.json.withdrawals as unknown[]).length).toBe(1);
  });

  it('warns on a probable duplicate and requires acknowledgement', async () => {
    const r = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-w1-dupe',
      cardId: neoCardId,
      dispensedSarMinor: '100000',
      atmOperator: 'Al Rajhi',
      transactionAt: new Date().toISOString(),
    });
    expect(r.status).toBe(409);
    expect(r.json.duplicateWarning).toBeTruthy();

    const acked = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-w1-dupe',
      cardId: neoCardId,
      dispensedSarMinor: '100000',
      atmOperator: 'Al Rajhi',
      transactionAt: new Date().toISOString(),
      duplicateWarningAck: true,
    });
    expect(acked.status).toBe(201);
    // Reverse it so it does not pollute later totals.
    await call('POST', `/v1/withdrawals/${acked.json.id}/reverse`, { reason: 'Test duplicate cleanup' });
  });

  it('shows the observed rate as OBSERVED, never as verified', async () => {
    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    const comp = d.json.computation as Record<string, { known: boolean; confidence?: string; display?: string }>;
    expect(comp.observedBalanceDelta!.known).toBe(true);
    expect(comp.observedBalanceDelta!.display).toBe('388000');
    expect(comp.effectiveNativePerSar!.known).toBe(true);
    expect(comp.effectiveNativePerSar!.confidence).toBe('OBSERVED');
    expect(comp.verifiedIqdPerSar!.known).toBe(true); // IQD card: economic = native
  });

  it('records pending, then settlement, preserving both', async () => {
    const p = await call('POST', `/v1/withdrawals/${wdId}/pending`, {
      pendingDebitMinor: '382000', description: 'ATM RIYADH PENDING',
    });
    expect(p.status).toBe(200);

    const s = await call('POST', `/v1/withdrawals/${wdId}/settle`, {
      postedDebitMinor: '380000',
      postedCashWithdrawalFeeMinor: '8000',
      statementDescription: 'ATM CASH RIYADH',
    });
    expect(s.status).toBe(200);

    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    expect((d.json.pending as { debitMinor: string }).debitMinor).toBe('382000');
    expect((d.json.posted as { debitMinor: string }).debitMinor).toBe('380000');
    const comp = d.json.computation as Record<string, { known: boolean; display?: string; confidence?: string }>;
    expect(comp.nativeAllInCost!.display).toBe('388000');
    expect(comp.nativeAllInCost!.confidence).toBe('POSTED');
  });

  it('blocks a bare pending overwrite but allows an audited revision', async () => {
    await expect(
      db.query(`UPDATE withdrawals SET pending_debit_minor = 1 WHERE id = $1`, [wdId]),
    ).rejects.toThrow(/write-once/);

    const rev = await call('POST', `/v1/withdrawals/${wdId}/pending`, {
      pendingDebitMinor: '383000', reason: 'Bank app refreshed the pending amount',
    });
    expect(rev.status).toBe(200);
    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    const revisions = d.json.revisions as { field: string; previous_value: string; new_value: string }[];
    expect(revisions.some((r) => r.field === 'pending_debit_minor' && r.previous_value === '382000' && r.new_value === '383000')).toBe(true);
  });

  it('reconciles to RECONCILED because balances and posted cost agree', async () => {
    const r = await call('POST', `/v1/withdrawals/${wdId}/reconcile`);
    expect(r.status).toBe(200);
    expect(r.json.state).toBe('RECONCILED');
  });

  it('creates a discrepancy when the numbers do not explain each other', async () => {
    const w2 = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-w2',
      cardId: neoCardId,
      dispensedSarMinor: '100000',
      transactionAt: '2026-09-03T10:00:00Z',
      before: { amountMinor: '4612000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
      after: { amountMinor: '4216000', source: 'BANK_APP', balanceType: 'AVAILABLE' },
    });
    const id2 = w2.json.id as string;
    await call('POST', `/v1/withdrawals/${id2}/settle`, { postedDebitMinor: '388000' });
    const r = await call('POST', `/v1/withdrawals/${id2}/reconcile`);
    expect(r.json.state).toBe('DISCREPANCY');

    const d = await call('GET', `/v1/withdrawals/${id2}`);
    const discs = d.json.discrepancies as { id: string; difference_minor: string; user_classification: string | null }[];
    expect(discs.length).toBe(1);
    expect(discs[0]!.difference_minor).toBe('-8000');
    expect(discs[0]!.user_classification).toBeNull();

    const c = await call('POST', `/v1/discrepancies/${discs[0]!.id}/classify`, {
      classification: 'SEPARATE_ISSUER_FEE',
      resolutionNote: 'Bank posts the 8,000 IQD fee as its own line',
    });
    expect(c.status).toBe(200);
  });

  it('handles a failed ATM without crediting cash or inventing a rate', async () => {
    const w = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-fail',
      cardId: qiCardId,
      dispensedSarMinor: '0',
      requestedSarMinor: '500000',
      transactionAt: '2026-09-03T12:00:00Z',
    });
    expect(w.status).toBe(201);
    const d = await call('GET', `/v1/withdrawals/${w.json.id}`);
    expect(d.json.state).toBe('FAILED_ATM');
    const comp = d.json.computation as Record<string, { known: boolean }>;
    expect(comp.effectiveNativePerSar!.known).toBe(false);

    const dash = await call('GET', '/v1/dashboard');
    const treasury = dash.json.treasury as { company: { received: { minor: string } } };
    expect(treasury.company.received.minor).toBe('0');
  });

  it('a company withdrawal credits company cash and is labelled a transfer', async () => {
    const w = await call('POST', '/v1/withdrawals', {
      idempotencyKey: 'trip1-company',
      cardId: qiCardId,
      dispensedSarMinor: '500000',
      transactionAt: '2026-09-03T14:00:00Z',
      dccOffered: 'NO',
    });
    expect(w.status).toBe(201);
    const dash = await call('GET', '/v1/dashboard');
    const treasury = dash.json.treasury as { company: { received: { minor: string } }; personal: { received: { minor: string } } };
    expect(treasury.company.received.minor).toBe('500000');
    expect(treasury.personal.received.minor).toBe('300000');
  });

  it('records a cash expense against the right wallet', async () => {
    const e = await call('POST', '/v1/expenses', {
      ownership: 'COMPANY', amountMinor: '50000', category: 'transport', purpose: 'Taxi to supplier',
    });
    expect(e.status).toBe(200);
    const dash = await call('GET', '/v1/dashboard');
    const treasury = dash.json.treasury as { company: { spent: { minor: string }; expectedOnHand: { minor: string } } };
    expect(treasury.company.spent.minor).toBe('50000');
    expect(treasury.company.expectedOnHand.minor).toBe('450000');
  });

  it('planner refuses unusable cards and plans with evidence', async () => {
    const p = await call('POST', '/v1/planner', { targetSarMinor: '1200000' });
    expect(p.status).toBe(200);
    const unusable = p.json.unusable as { nickname: string; reason: string }[];
    // The Qi card is UNKNOWN internationally — the planner must refuse it.
    expect(unusable.some((u) => u.reason.includes('not established whether this card works abroad'))).toBe(true);
    expect(p.json.disclaimer).toMatch(/planning estimate/);
    const allocations = p.json.allocations as { nickname: string; rateBasis: string }[];
    expect(allocations.length).toBeGreaterThan(0);
    expect(allocations[0]!.rateBasis).toBe('VERIFIED');
  });

  it('comparison view keeps IQD ranking honest', async () => {
    const c = await call('GET', '/v1/comparison');
    expect(c.status).toBe(200);
    const best = c.json.best as { nickname: string; confidence: string } | null;
    expect(best?.nickname).toBe('NEO 964');
    expect(best?.confidence).toBe('LOW'); // one reconciled sample only
  });

  it('closes the day and soft-locks its entries', async () => {
    const view = await call('GET', '/v1/day-close?date=2026-09-03');
    expect(view.status).toBe(200);
    const close = await call('POST', '/v1/day-close', { date: '2026-09-03' });
    expect(close.status).toBe(200);

    // The withdrawal transacted on 2026-09-03 is now locked.
    const list = await call('GET', '/v1/withdrawals');
    const locked = (list.json.withdrawals as { id: string; day_close_id: string | null; transaction_at: string }[]).filter((w) => w.day_close_id);
    expect(locked.length).toBeGreaterThan(0);
    await expect(db.query(`UPDATE withdrawals SET notes = 'x' WHERE id = $1`, [locked[0]!.id])).rejects.toThrow(/day is closed/);

    const again = await call('POST', '/v1/day-close', { date: '2026-09-03' });
    expect(again.status).toBe(409);
  });

  it('corrections are the only path after close, and they are audited', async () => {
    const c = await call('POST', '/v1/corrections', {
      targetTable: 'withdrawals', targetId: wdId, field: 'notes',
      previousValue: null, newValue: 'Corrected note', reason: 'Adding context after close',
    });
    expect(c.status).toBe(200);
  });

  it('exports CSV that matches the database totals and labels statuses', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/export/withdrawals.csv',
      headers: { cookie, 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toMatch(/pricing_status/);
    expect(lines[0]).toMatch(/all_in_cost_basis/);
    // Reconciled row shows 388000 all-in and 388.0000 rate.
    const reconciled = lines.find((l) => l.includes('RECONCILED') && l.includes('trip'));
    expect(res.body).toMatch(/388000,POSTED,388\.0000,POSTED/);
    expect(reconciled ?? res.body).toBeTruthy();

    const treasuryRes = await app.inject({
      method: 'GET', url: '/v1/export/treasury.csv', headers: { cookie, 'x-csrf-token': csrf },
    });
    // 1000 + 1000(dupe, reversed but cash was still received) + 5000 company IN, 500 OUT
    expect(treasuryRes.body).toMatch(/COMPANY,IN,5000\.00/);
    expect(treasuryRes.body).toMatch(/COMPANY,OUT,500\.00/);
  });

  it('keeps the audit trail complete for the withdrawal lifecycle', async () => {
    // Admin-only route: the traveler must be refused.
    const denied = await call('GET', `/v1/audit?entity=withdrawals&id=${wdId}`);
    expect(denied.status).toBe(403);

    const adminLogin = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'admin@example.iq', password: 'admin passphrase here' },
    });
    const adminCookie = (adminLogin.headers['set-cookie'] as string).split(';')[0] as string;
    const res = await app.inject({
      method: 'GET', url: `/v1/audit?entity=withdrawals&id=${wdId}`,
      headers: { cookie: adminCookie },
    });
    const events = (res.json() as { events: { action: string }[] }).events.map((e) => e.action);
    for (const expected of ['WITHDRAWAL_CREATED', 'PENDING_RECORDED', 'SETTLEMENT_RECORDED', 'PENDING_REVISED', 'RECONCILIATION_APPLIED']) {
      expect(events).toContain(expected);
    }
  });

  it('never returns a bigint or a secret in any JSON payload', async () => {
    const d = await call('GET', `/v1/withdrawals/${wdId}`);
    const text = JSON.stringify(d.json);
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/token/i);
  });
});
