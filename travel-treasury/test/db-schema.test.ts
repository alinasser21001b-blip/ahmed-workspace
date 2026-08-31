import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDb, migrate, type Db } from '../src/server/db/db.ts';

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await db.query(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES ('u1','t@t','x','TRAVELER','Traveler')`,
  );
  await db.query(
    `INSERT INTO trips (id, name, destination, start_date) VALUES ('t1','Umrah','Saudi Arabia','2026-09-01')`,
  );
  await db.query(
    `INSERT INTO cards (id, trip_id, nickname, issuer, product, network, card_type, last4, ownership, native_currency)
     VALUES ('c_co','t1','Qi company','Rafidain','Qi Mastercard','MASTERCARD','CORPORATE','1111','COMPANY','IQD'),
            ('c_pe','t1','NEO 964','NEO Iraq','NEO 964','VISA','PREPAID','2222','PERSONAL','IQD')`,
  );
  await db.query(
    `INSERT INTO cash_wallets (id, trip_id, ownership) VALUES ('w_pe','t1','PERSONAL'), ('w_co','t1','COMPANY')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('database-enforced invariants', () => {
  it('migration is idempotent', async () => {
    await migrate(db);
    const r = await db.query(`SELECT count(*)::int AS n FROM users`);
    expect(r.rows[0]).toEqual({ n: 1 });
  });

  it('rejects a last4 that is not exactly four digits', async () => {
    await expect(
      db.query(
        `INSERT INTO cards (id, nickname, issuer, product, network, card_type, last4, ownership, native_currency)
         VALUES ('bad','x','x','x','VISA','DEBIT','12345','PERSONAL','IQD')`,
      ),
    ).rejects.toThrow(/last4/);
  });

  it('rejects negative dispensed cash at the column level', async () => {
    await expect(
      db.query(
        `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
         VALUES ('w_neg','k_neg','t1','c_pe','PERSONAL','CAPTURED', now(), -1, 'u1')`,
      ),
    ).rejects.toThrow(/dispensed_sar_minor/);
  });

  it('rejects a withdrawal whose ownership contradicts its card', async () => {
    await expect(
      db.query(
        `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
         VALUES ('w_leak','k_leak','t1','c_co','PERSONAL','CAPTURED', now(), 100000, 'u1')`,
      ),
    ).rejects.toThrow(/does not match card ownership/);
  });

  it('enforces idempotency keys as unique', async () => {
    await db.query(
      `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
       VALUES ('w1','key-1','t1','c_pe','PERSONAL','CAPTURED', now(), 100000, 'u1')`,
    );
    await expect(
      db.query(
        `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
         VALUES ('w2','key-1','t1','c_pe','PERSONAL','CAPTURED', now(), 100000, 'u1')`,
      ),
    ).rejects.toThrow(/idempotency_key|duplicate key/);
  });

  it('refuses to route company cash into the personal wallet', async () => {
    await db.query(
      `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
       VALUES ('w_co','k_co','t1','c_co','COMPANY','CAPTURED', now(), 500000, 'u1')`,
    );
    await expect(
      db.query(
        `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, created_by)
         VALUES ('m_bad','w_pe','IN',500000,'ATM_WITHDRAWAL','w_co', now(), 'u1')`,
      ),
    ).rejects.toThrow(/Refusing to move COMPANY money into the PERSONAL wallet/);
    // The correct wallet accepts it.
    await db.query(
      `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, created_by)
       VALUES ('m_ok','w_co','IN',500000,'ATM_WITHDRAWAL','w_co', now(), 'u1')`,
    );
  });

  it('refuses cash from a withdrawal that dispensed nothing', async () => {
    await db.query(
      `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
       VALUES ('w_fail','k_fail','t1','c_pe','PERSONAL','FAILED_ATM', now(), 0, 'u1')`,
    );
    await expect(
      db.query(
        `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, created_by)
         VALUES ('m_fail','w_pe','IN',100,'ATM_WITHDRAWAL','w_fail', now(), 'u1')`,
      ),
    ).rejects.toThrow(/dispensed no cash/);
  });

  it('refuses a cash movement larger than the cash dispensed', async () => {
    await expect(
      db.query(
        `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, created_by)
         VALUES ('m_big','w_co','IN',600000,'ATM_WITHDRAWAL','w_co', now(), 'u1')`,
      ),
    ).rejects.toThrow(/exceeds cash dispensed/);
  });

  it('makes pending figures write-once', async () => {
    await db.query(
      `UPDATE withdrawals SET pending_debit_minor = 382000, pending_debit_currency='IQD', pending_at = now() WHERE id = 'w1'`,
    );
    await expect(
      db.query(`UPDATE withdrawals SET pending_debit_minor = 999999 WHERE id = 'w1'`),
    ).rejects.toThrow(/write-once/);
    // Posting a settlement beside it is fine.
    await db.query(
      `UPDATE withdrawals SET posted_debit_minor = 387250, posted_debit_currency='IQD', posted_at = now(), state='POSTED' WHERE id = 'w1'`,
    );
    const r = await db.query<{ p: string; f: string }>(
      `SELECT pending_debit_minor::text AS p, posted_debit_minor::text AS f FROM withdrawals WHERE id='w1'`,
    );
    expect(r.rows[0]).toEqual({ p: '382000', f: '387250' });
  });

  it('soft-locks a closed day', async () => {
    await db.query(
      `INSERT INTO day_closes (id, trip_id, close_date, status, closed_at, closed_by) VALUES ('d1','t1','2026-09-02','CLOSED', now(), 'u1')`,
    );
    await db.query(`UPDATE withdrawals SET day_close_id = 'd1' WHERE id = 'w1'`);
    await expect(db.query(`UPDATE withdrawals SET notes = 'sneaky edit' WHERE id = 'w1'`)).rejects.toThrow(
      /day is closed/i,
    );
  });

  it('rolls the whole financial write back when any part fails', async () => {
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM withdrawals`);
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO withdrawals (id, idempotency_key, trip_id, card_id, ownership, state, transaction_at, dispensed_sar_minor, created_by)
           VALUES ('w_tx','k_tx','t1','c_pe','PERSONAL','CAPTURED', now(), 100000, 'u1')`,
        );
        // This second write violates the wallet-ownership trigger...
        await tx.query(
          `INSERT INTO cash_movements (id, wallet_id, direction, amount_minor, kind, withdrawal_id, occurred_at, created_by)
           VALUES ('m_tx','w_co','IN',100000,'ATM_WITHDRAWAL','w_tx', now(), 'u1')`,
        );
      }),
    ).rejects.toThrow();
    // ...and the withdrawal insert must be gone with it.
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM withdrawals`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    const gone = await db.query(`SELECT id FROM withdrawals WHERE id = 'w_tx'`);
    expect(gone.rows).toHaveLength(0);
  });
});
