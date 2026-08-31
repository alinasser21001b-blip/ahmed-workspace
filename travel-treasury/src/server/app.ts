import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { Db } from './db/db.ts';
import { createSession, loginRateLimit, revokeSession, userForSession, verifyPassword, type AuthedUser } from './auth.ts';
import {
  addCashExpense, applyReconciliation, classifyDiscrepancy, closeDay, createWithdrawal,
  ensureTripAndWallets, insertSnapshot, recordCorrection, recordPending, recordSettlement,
  reverseWithdrawal, audit,
} from './services.ts';
import { cardDashboard, comparisonView, dashboardView, dayCloseView, plannerView, withdrawalDetail } from './views.ts';
import { auditCsv, reconciliationCsv, treasuryCsv, withdrawalsCsv } from './csv.ts';
import { HttpError, newId, oneOf, optionalMinor, optionalOneOf, optionalString, parseMinor, requireString } from './util.ts';
import { getCardRow } from './repo.ts';

const SESSION_COOKIE = 'tt_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export interface AppOptions {
  db: Db;
  secureCookies?: boolean;
  trustProxy?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const app = Fastify({
    logger: false,
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 512 * 1024,
  });
  await app.register(cookie);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.status(err.statusCode).send({ error: err.message, errorAr: err.messageAr ?? null });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    // Database trigger violations carry the invariant text; surface it.
    const status =
      /write-once|Refusing to move|dispensed no cash|does not match card ownership|day is closed|exceeds cash dispensed|Illegal withdrawal state/.test(message)
        ? 409
        : 500;
    // No request bodies, no financial values in logs — message text only.
    if (status === 500) console.error('[api]', message);
    reply.status(status).send({ error: status === 500 ? 'Internal error' : message, errorAr: null });
  });

  const authed = (requireCsrf: boolean) =>
    async function preHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const token = req.cookies[SESSION_COOKIE];
      const csrf = req.headers['x-csrf-token'];
      req.user = await userForSession(db, token, typeof csrf === 'string' ? csrf : undefined, requireCsrf);
    };
  const requireAdmin = async (req: FastifyRequest): Promise<void> => {
    if (req.user?.role !== 'ADMIN') throw new HttpError(403, 'Admin only', 'خاص بالمسؤول فقط');
  };

  // ------------------------------------------------------------- health ----
  app.get('/health', async () => ({ ok: true }));

  // --------------------------------------------------------------- auth ----
  app.post('/v1/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = requireString(body.email, 'email', 200).toLowerCase();
    const ip = req.ip ?? 'unknown';
    if (!loginRateLimit(`${ip}:${email}`)) {
      throw new HttpError(429, 'Too many attempts; try again later', 'محاولات كثيرة، حاول لاحقًا');
    }
    const password = requireString(body.password, 'password', 500);
    const res = await db.query<{ id: string; password_hash: string; is_active: boolean }>(
      `SELECT id, password_hash, is_active FROM users WHERE email = $1`,
      [email],
    );
    const row = res.rows[0];
    const ok = row ? await verifyPassword(row.password_hash, password) : false;
    if (!row || !ok || !row.is_active) {
      throw new HttpError(401, 'Wrong email or password', 'البريد أو كلمة المرور غير صحيحة');
    }
    const session = await createSession(db, row.id);
    await audit(db, row.id, 'LOGIN', 'users', row.id, null, null);
    reply.setCookie(SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: opts.secureCookies ?? true,
      path: '/',
      expires: new Date(session.expiresAt),
    });
    const user = await userForSession(db, session.sessionToken, undefined, false);
    return { csrfToken: session.csrfToken, user };
  });

  app.post('/v1/auth/logout', { preHandler: authed(true) }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/v1/auth/me', { preHandler: authed(false) }, async (req) => ({ user: req.user }));

  // --------------------------------------------------------------- trip ----
  app.get('/v1/trip', { preHandler: authed(false) }, async () => {
    const { tripId } = await ensureTripAndWallets(db);
    const res = await db.query(`SELECT id, name, destination, start_date::text AS start_date, end_date::text AS end_date, local_currency, reporting_currency, local_timezone, status, notes FROM trips WHERE id = $1`, [tripId]);
    return { trip: res.rows[0] };
  });

  // -------------------------------------------------------------- cards ----
  app.get('/v1/cards', { preHandler: authed(false) }, async () => {
    const { tripId } = await ensureTripAndWallets(db);
    const res = await db.query(
      `SELECT id, nickname, issuer, product, network, card_type, last4, ownership, native_currency,
              opening_available_minor::text AS opening_available_minor,
              daily_atm_limit_minor::text AS daily_atm_limit_minor, daily_atm_limit_currency,
              per_transaction_limit_minor::text AS per_transaction_limit_minor, per_transaction_limit_currency,
              intl_monthly_limit_minor::text AS intl_monthly_limit_minor, intl_monthly_limit_currency,
              international_status, is_active, notes
         FROM cards WHERE trip_id = $1 ORDER BY created_at`,
      [tripId],
    );
    return { cards: res.rows };
  });

  app.post('/v1/cards', { preHandler: authed(true) }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { tripId } = await ensureTripAndWallets(db);
    const id = newId('card');
    const last4 = requireString(b.last4, 'last4', 4);
    if (!/^\d{4}$/.test(last4)) throw new HttpError(400, 'last4 must be exactly four digits', 'أدخل آخر ٤ أرقام فقط');
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO cards (id, trip_id, nickname, issuer, product, network, card_type, last4, ownership, native_currency,
                            opening_available_minor, daily_atm_limit_minor, daily_atm_limit_currency,
                            per_transaction_limit_minor, per_transaction_limit_currency,
                            intl_monthly_limit_minor, intl_monthly_limit_currency, international_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          id, tripId,
          requireString(b.nickname, 'nickname', 100),
          requireString(b.issuer, 'issuer', 200),
          requireString(b.product, 'product', 200),
          oneOf(b.network, ['VISA', 'MASTERCARD', 'OTHER', 'UNKNOWN'] as const, 'network'),
          oneOf(b.cardType, ['DEBIT', 'CREDIT', 'PREPAID', 'CORPORATE', 'UNKNOWN'] as const, 'cardType'),
          last4,
          oneOf(b.ownership, ['PERSONAL', 'COMPANY'] as const, 'ownership'),
          oneOf(b.nativeCurrency, ['IQD', 'USD', 'SAR'] as const, 'nativeCurrency'),
          optionalMinor(b.openingAvailableMinor, 'opening balance')?.toString() ?? null,
          optionalMinor(b.dailyAtmLimitMinor, 'daily limit')?.toString() ?? null,
          optionalOneOf(b.dailyAtmLimitCurrency, ['IQD', 'USD', 'SAR'] as const, 'daily limit currency'),
          optionalMinor(b.perTransactionLimitMinor, 'per-transaction limit')?.toString() ?? null,
          optionalOneOf(b.perTransactionLimitCurrency, ['IQD', 'USD', 'SAR'] as const, 'per-transaction limit currency'),
          optionalMinor(b.intlMonthlyLimitMinor, 'monthly limit')?.toString() ?? null,
          optionalOneOf(b.intlMonthlyLimitCurrency, ['IQD', 'USD', 'SAR'] as const, 'monthly limit currency'),
          optionalOneOf(b.internationalStatus, ['CONFIRMED_WORKING', 'CLAIMED_BY_ISSUER', 'RESTRICTED_BY_REGULATION', 'UNKNOWN'] as const, 'internationalStatus') ?? 'UNKNOWN',
          optionalString(b.notes, 'notes'),
        ],
      );
      await audit(tx, req.user!.id, 'CARD_CREATED', 'cards', id, null, { nickname: b.nickname, issuer: b.issuer, last4 });
    });
    return { id };
  });

  app.patch('/v1/cards/:id', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const before = await getCardRow(db, id);
    const fields: string[] = [];
    const values: unknown[] = [id];
    const set = (col: string, val: unknown) => {
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };
    if (b.nickname !== undefined) set('nickname', requireString(b.nickname, 'nickname', 100));
    if (b.internationalStatus !== undefined)
      set('international_status', oneOf(b.internationalStatus, ['CONFIRMED_WORKING', 'CLAIMED_BY_ISSUER', 'RESTRICTED_BY_REGULATION', 'UNKNOWN'] as const, 'internationalStatus'));
    if (b.internationalStatusEvidence !== undefined) set('international_status_evidence', optionalString(b.internationalStatusEvidence, 'evidence'));
    if (b.isActive !== undefined) set('is_active', b.isActive === true);
    if (b.openingAvailableMinor !== undefined) set('opening_available_minor', optionalMinor(b.openingAvailableMinor, 'opening balance')?.toString() ?? null);
    if (b.dailyAtmLimitMinor !== undefined) set('daily_atm_limit_minor', optionalMinor(b.dailyAtmLimitMinor, 'daily limit')?.toString() ?? null);
    if (b.dailyAtmLimitCurrency !== undefined) set('daily_atm_limit_currency', optionalOneOf(b.dailyAtmLimitCurrency, ['IQD', 'USD', 'SAR'] as const, 'daily limit currency'));
    if (b.perTransactionLimitMinor !== undefined) set('per_transaction_limit_minor', optionalMinor(b.perTransactionLimitMinor, 'per-transaction limit')?.toString() ?? null);
    if (b.intlMonthlyLimitMinor !== undefined) set('intl_monthly_limit_minor', optionalMinor(b.intlMonthlyLimitMinor, 'monthly limit')?.toString() ?? null);
    if (b.intlMonthlyLimitCurrency !== undefined) set('intl_monthly_limit_currency', optionalOneOf(b.intlMonthlyLimitCurrency, ['IQD', 'USD', 'SAR'] as const, 'monthly limit currency'));
    if (b.notes !== undefined) set('notes', optionalString(b.notes, 'notes'));
    if (fields.length === 0) return { ok: true };
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE cards SET ${fields.join(', ')} WHERE id = $1`, values);
      await audit(tx, req.user!.id, 'CARD_UPDATED', 'cards', id,
        { international_status: before.international_status, is_active: before.is_active }, b as unknown);
    });
    return { ok: true };
  });

  app.get('/v1/cards/:id/dashboard', { preHandler: authed(false) }, async (req) => {
    const { id } = req.params as { id: string };
    const view = await cardDashboard(db, id);
    if (!view) throw new HttpError(404, 'Card not found', 'البطاقة غير موجودة');
    return view;
  });

  app.post('/v1/cards/:id/snapshots', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    const card = await getCardRow(db, id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    let snapId = '';
    await db.transaction(async (tx) => {
      snapId = await insertSnapshot(tx, req.user!, id, card.native_currency, b as never, 'Asia/Riyadh');
      await audit(tx, req.user!.id, 'BALANCE_SNAPSHOT', 'balance_snapshots', snapId, null, { cardId: id });
    });
    return { id: snapId };
  });

  app.post('/v1/cards/:id/funding', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    const card = await getCardRow(db, id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fid = newId('fund');
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO funding_events (id, card_id, credited_minor, credited_currency, iqd_paid_minor, funding_fee_minor, funding_fee_currency, occurred_at, source, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          fid, id,
          parseMinor(b.creditedMinor, 'credited amount').toString(), card.native_currency,
          optionalMinor(b.iqdPaidMinor, 'IQD paid')?.toString() ?? null,
          optionalMinor(b.fundingFeeMinor, 'funding fee')?.toString() ?? null,
          b.fundingFeeMinor !== undefined && b.fundingFeeMinor !== null && b.fundingFeeMinor !== '' ? 'IQD' : null,
          typeof b.occurredAt === 'string' && b.occurredAt ? new Date(b.occurredAt).toISOString() : new Date().toISOString(),
          oneOf(b.source ?? 'MANUAL', ['BANK_APP', 'STATEMENT', 'RECEIPT', 'MANUAL'] as const, 'source'),
          optionalString(b.notes, 'notes'),
          req.user!.id,
        ],
      );
      await audit(tx, req.user!.id, 'FUNDING_RECORDED', 'funding_events', fid, null, { cardId: id });
    });
    return { id: fid };
  });

  // -------------------------------------------------------- withdrawals ----
  app.post('/v1/withdrawals', { preHandler: authed(true) }, async (req, reply) => {
    const result = await createWithdrawal(db, req.user!, (req.body ?? {}) as never);
    if (!result.created && result.duplicateWarning && !result.id) {
      reply.status(409);
      return { duplicateWarning: result.duplicateWarning, hint: 'Repeat with duplicateWarningAck: true to record it anyway.' };
    }
    reply.status(result.created ? 201 : 200);
    return result;
  });

  app.get('/v1/withdrawals', { preHandler: authed(false) }, async (req) => {
    const { tripId } = await ensureTripAndWallets(db);
    const q = req.query as { card?: string; state?: string; scope?: string };
    const params: unknown[] = [tripId];
    let where = 'w.trip_id = $1';
    if (q.card) {
      params.push(q.card);
      where += ` AND w.card_id = $${params.length}`;
    }
    if (q.state) {
      params.push(q.state);
      where += ` AND w.state = $${params.length}`;
    }
    if (q.scope === 'PERSONAL' || q.scope === 'COMPANY') {
      params.push(q.scope);
      where += ` AND w.ownership = $${params.length}`;
    }
    const res = await db.query(
      `SELECT w.id, w.state, w.ownership, w.transaction_at, w.transaction_local_time,
              w.dispensed_sar_minor::text AS dispensed_sar_minor,
              w.requested_sar_minor::text AS requested_sar_minor,
              w.pending_debit_minor::text AS pending_debit_minor,
              w.posted_debit_minor::text AS posted_debit_minor,
              w.dcc_offered, w.dcc_selection, w.atm_operator, w.day_close_id,
              c.nickname, c.native_currency, c.last4
         FROM withdrawals w JOIN cards c ON c.id = w.card_id
        WHERE ${where} ORDER BY w.transaction_at DESC LIMIT 200`,
      params,
    );
    return { withdrawals: res.rows };
  });

  app.get('/v1/withdrawals/:id', { preHandler: authed(false) }, async (req) => {
    const { id } = req.params as { id: string };
    return withdrawalDetail(db, id);
  });

  app.post('/v1/withdrawals/:id/pending', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    await recordPending(db, req.user!, id, (req.body ?? {}) as never);
    return { ok: true };
  });

  app.post('/v1/withdrawals/:id/settle', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    await recordSettlement(db, req.user!, id, (req.body ?? {}) as never);
    return { ok: true };
  });

  app.post('/v1/withdrawals/:id/reconcile', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    return applyReconciliation(db, req.user!, id);
  });

  app.post('/v1/withdrawals/:id/reverse', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    await reverseWithdrawal(db, req.user!, id, (req.body ?? {}) as never);
    return { ok: true };
  });

  app.post('/v1/discrepancies/:id/classify', { preHandler: authed(true) }, async (req) => {
    const { id } = req.params as { id: string };
    await classifyDiscrepancy(db, req.user!, id, (req.body ?? {}) as never);
    return { ok: true };
  });

  // ------------------------------------------------------------ treasury ----
  app.post('/v1/expenses', { preHandler: authed(true) }, async (req) => {
    return addCashExpense(db, req.user!, (req.body ?? {}) as never);
  });

  // ------------------------------------------------------------- views ----
  app.get('/v1/dashboard', { preHandler: authed(false) }, async (req) => {
    const { tripId } = await ensureTripAndWallets(db);
    const q = req.query as { scope?: string };
    const scope = q.scope === 'PERSONAL' || q.scope === 'COMPANY' ? q.scope : 'ALL';
    return dashboardView(db, tripId, scope);
  });

  app.get('/v1/comparison', { preHandler: authed(false) }, async () => {
    const { tripId } = await ensureTripAndWallets(db);
    return comparisonView(db, tripId);
  });

  app.post('/v1/planner', { preHandler: authed(true) }, async (req) => {
    const { tripId } = await ensureTripAndWallets(db);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const scope = b.ownership === 'PERSONAL' || b.ownership === 'COMPANY' ? b.ownership : 'ALL';
    return plannerView(db, tripId, b.targetSarMinor, scope as never);
  });

  // ---------------------------------------------------------- day close ----
  app.get('/v1/day-close', { preHandler: authed(false) }, async (req) => {
    const { tripId } = await ensureTripAndWallets(db);
    const q = req.query as { date?: string };
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : new Date().toISOString().slice(0, 10);
    return dayCloseView(db, tripId, date);
  });

  app.post('/v1/day-close', { preHandler: authed(true) }, async (req) => {
    const { tripId } = await ensureTripAndWallets(db);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const date = requireString(b.date, 'date', 10);
    const snapshot = await dayCloseView(db, tripId, date);
    return closeDay(db, req.user!, tripId, date, snapshot);
  });

  app.post('/v1/corrections', { preHandler: authed(true) }, async (req) => {
    return recordCorrection(db, req.user!, (req.body ?? {}) as never);
  });

  // -------------------------------------------------- sources and rules ----
  app.get('/v1/sources', { preHandler: authed(false) }, async () => {
    const res = await db.query(`SELECT * FROM financial_sources ORDER BY id`);
    return { sources: res.rows };
  });

  app.get('/v1/fee-rules', { preHandler: authed(false) }, async () => {
    const res = await db.query(
      `SELECT id, card_id, issuer, product, rule_type, transaction_type, region,
              amount_minor::text AS amount_minor, amount_currency, percent::text AS percent,
              min_minor::text AS min_minor, max_minor::text AS max_minor, amount_is_range,
              currency, effective_from::text AS effective_from, effective_to::text AS effective_to,
              source_id, confidence, verified_at::text AS verified_at, is_ambiguous, ambiguity_note, notes
         FROM fee_rules ORDER BY issuer, product NULLS FIRST, rule_type, effective_from`,
    );
    return { rules: res.rows };
  });

  app.post('/v1/fee-rules', { preHandler: [authed(true), requireAdmin] }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = newId('rule');
    await db.transaction(async (tx) => {
      // A user-confirmed rule supersedes a seeded one by closing it, never by
      // editing it — history keeps pricing with the rule that was in force.
      const supersedes = optionalString(b.supersedesRuleId, 'supersedesRuleId', 100);
      const effectiveFrom = requireString(b.effectiveFrom, 'effectiveFrom', 10);
      if (supersedes) {
        await tx.query(`UPDATE fee_rules SET effective_to = ($2::date - 1) WHERE id = $1 AND effective_to IS NULL`, [supersedes, effectiveFrom]);
      }
      await tx.query(
        `INSERT INTO fee_rules (id, card_id, issuer, product, rule_type, transaction_type, region, amount_minor, amount_currency,
                                percent, min_minor, max_minor, amount_is_range, currency, effective_from, source_id, confidence, verified_at, is_ambiguous, ambiguity_note, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          id,
          optionalString(b.cardId, 'cardId', 100),
          optionalString(b.issuer, 'issuer', 200),
          optionalString(b.product, 'product', 200),
          oneOf(b.ruleType, ['ATM_WITHDRAWAL_FEE', 'FX_FEE', 'INTERNATIONAL_FEE', 'CASH_ADVANCE_FEE', 'ANNUAL_FEE', 'TRANSFER_FEE', 'OTHER'] as const, 'ruleType'),
          optionalOneOf(b.transactionType, ['ATM_WITHDRAWAL', 'POS', 'ONLINE', 'TRANSFER', 'ANY'] as const, 'transactionType') ?? 'ATM_WITHDRAWAL',
          optionalOneOf(b.region, ['CEMEA', 'NON_CEMEA', 'DOMESTIC', 'ANY'] as const, 'region') ?? 'ANY',
          optionalMinor(b.amountMinor, 'amount')?.toString() ?? null,
          optionalOneOf(b.amountCurrency, ['IQD', 'USD', 'SAR'] as const, 'amount currency'),
          optionalString(b.percent, 'percent', 20),
          optionalMinor(b.minMinor, 'min')?.toString() ?? null,
          optionalMinor(b.maxMinor, 'max')?.toString() ?? null,
          b.amountIsRange === true,
          oneOf(b.currency, ['IQD', 'USD', 'SAR'] as const, 'currency'),
          effectiveFrom,
          optionalString(b.sourceId, 'sourceId', 50) ?? 'MANUAL',
          oneOf(b.confidence, ['VERIFIED', 'LIKELY', 'UNVERIFIED', 'UNKNOWN'] as const, 'confidence'),
          b.confidence === 'VERIFIED' ? new Date().toISOString().slice(0, 10) : null,
          b.isAmbiguous === true,
          optionalString(b.ambiguityNote, 'ambiguityNote'),
          optionalString(b.notes, 'notes'),
        ],
      );
      await audit(tx, req.user!.id, 'FEE_RULE_ADDED', 'fee_rules', id, null, b as unknown);
    });
    return { id };
  });

  app.post('/v1/reference-rates', { preHandler: authed(true) }, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = newId('ref');
    const rate = requireString(b.rate, 'rate', 30);
    if (!/^\d+(\.\d+)?$/.test(rate)) throw new HttpError(400, 'rate must be a positive decimal', 'أدخل سعر صرف صحيحًا');
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO reference_rates (id, base_currency, quote_currency, rate, rate_type, effective_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          oneOf(b.baseCurrency, ['IQD', 'USD', 'SAR'] as const, 'baseCurrency'),
          oneOf(b.quoteCurrency, ['IQD', 'USD', 'SAR'] as const, 'quoteCurrency'),
          rate,
          oneOf(b.rateType, ['OFFICIAL', 'MID_MARKET', 'ISSUER', 'ATM_OFFERED', 'USER_ESTIMATE'] as const, 'rateType'),
          requireString(b.effectiveDate, 'effectiveDate', 10),
          optionalString(b.notes, 'notes'),
        ],
      );
      await audit(tx, req.user!.id, 'REFERENCE_RATE_ADDED', 'reference_rates', id, null, b as unknown);
    });
    return { id };
  });

  app.get('/v1/audit', { preHandler: [authed(false), requireAdmin] }, async (req) => {
    const q = req.query as { entity?: string; id?: string };
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q.entity) {
      params.push(q.entity);
      where += ` AND entity_table = $${params.length}`;
    }
    if (q.id) {
      params.push(q.id);
      where += ` AND entity_id = $${params.length}`;
    }
    const res = await db.query(
      `SELECT id, actor_user_id, action, entity_table, entity_id, previous_value, new_value, reason, occurred_at
         FROM audit_events WHERE ${where} ORDER BY occurred_at DESC LIMIT 500`,
      params,
    );
    return { events: res.rows };
  });

  // ------------------------------------------------------------ exports ----
  const sendCsv = (reply: FastifyReply, name: string, body: string) => {
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return body;
  };

  app.get('/v1/export/withdrawals.csv', { preHandler: authed(false) }, async (req, reply) => {
    const { tripId } = await ensureTripAndWallets(db);
    const q = req.query as { scope?: string; date?: string; from?: string; to?: string };
    const csv = await withdrawalsCsv(db, {
      tripId,
      ownership: q.scope === 'PERSONAL' || q.scope === 'COMPANY' ? q.scope : null,
      date: q.date ?? null,
      from: q.from ?? null,
      to: q.to ?? null,
    });
    return sendCsv(reply, `withdrawals-${q.scope ?? 'all'}.csv`, csv);
  });

  app.get('/v1/export/reconciliation.csv', { preHandler: authed(false) }, async (_req, reply) => {
    const { tripId } = await ensureTripAndWallets(db);
    return sendCsv(reply, 'reconciliation.csv', await reconciliationCsv(db, tripId));
  });

  app.get('/v1/export/treasury.csv', { preHandler: authed(false) }, async (_req, reply) => {
    const { tripId } = await ensureTripAndWallets(db);
    return sendCsv(reply, 'treasury.csv', await treasuryCsv(db, tripId));
  });

  app.get('/v1/export/audit.csv', { preHandler: [authed(false), requireAdmin] }, async (_req, reply) => {
    return sendCsv(reply, 'audit.csv', await auditCsv(db));
  });

  return app;
}
