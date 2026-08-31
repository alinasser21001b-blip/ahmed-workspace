-- Travel Treasury & Card Reconciliation — schema
--
-- Money is always BIGINT minor units plus a currency code. There is no
-- floating point column in this file. Exchange rates use NUMERIC, which is
-- exact, and are always read back as text.
--
-- Nothing here can hold a card credential: no column exists for a card number,
-- a secret code, a security code, a one-time code or a banking password, and
-- the last four digits are constrained to exactly four digits.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('TRAVELER','ADMIN')),
  display_name    TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS trips (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  destination        TEXT NOT NULL,
  start_date         DATE NOT NULL,
  end_date           DATE,
  local_currency     TEXT NOT NULL DEFAULT 'SAR',
  reporting_currency TEXT NOT NULL DEFAULT 'IQD',
  local_timezone     TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence registry: where every seeded tariff rule came from, and whether the
-- document was actually opened. See docs/FINANCIAL-RESEARCH.md section 12.
CREATE TABLE IF NOT EXISTS financial_sources (
  id                TEXT PRIMARY KEY,
  institution       TEXT NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL DEFAULT '',
  source_class      TEXT NOT NULL CHECK (source_class IN ('PRIMARY','SECONDARY')),
  accessed_at       DATE NOT NULL,
  published_at      TEXT,
  retrieval_status  TEXT NOT NULL CHECK (retrieval_status IN ('RETRIEVED','BLOCKED','SNIPPET_ONLY')),
  notes             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cards (
  id                             TEXT PRIMARY KEY,
  trip_id                        TEXT REFERENCES trips(id),
  nickname                       TEXT NOT NULL,
  issuer                         TEXT NOT NULL,
  product                        TEXT NOT NULL,
  network                        TEXT NOT NULL CHECK (network IN ('VISA','MASTERCARD','OTHER','UNKNOWN')),
  card_type                      TEXT NOT NULL CHECK (card_type IN ('DEBIT','CREDIT','PREPAID','CORPORATE','UNKNOWN')),
  last4                          TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  ownership                      TEXT NOT NULL CHECK (ownership IN ('PERSONAL','COMPANY')),
  native_currency                TEXT NOT NULL CHECK (native_currency IN ('IQD','USD','SAR')),
  opening_available_minor        BIGINT,
  opening_ledger_minor           BIGINT,
  daily_atm_limit_minor          BIGINT,
  daily_atm_limit_currency       TEXT,
  per_transaction_limit_minor    BIGINT,
  per_transaction_limit_currency TEXT,
  intl_monthly_limit_minor       BIGINT,
  intl_monthly_limit_currency    TEXT,
  trip_allocation_minor          BIGINT,
  international_status           TEXT NOT NULL DEFAULT 'UNKNOWN'
                                 CHECK (international_status IN ('CONFIRMED_WORKING','CLAIMED_BY_ISSUER','RESTRICTED_BY_REGULATION','UNKNOWN')),
  international_status_evidence  TEXT,
  is_active                      BOOLEAN NOT NULL DEFAULT TRUE,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cards_trip ON cards(trip_id);

-- Effective-dated tariffs. A price change inserts a new row and closes the old
-- one; it never updates an existing row, so a past transaction keeps its price.
CREATE TABLE IF NOT EXISTS fee_rules (
  id               TEXT PRIMARY KEY,
  card_id          TEXT REFERENCES cards(id),
  issuer           TEXT,
  product          TEXT,
  rule_type        TEXT NOT NULL CHECK (rule_type IN ('ATM_WITHDRAWAL_FEE','FX_FEE','INTERNATIONAL_FEE','CASH_ADVANCE_FEE','ANNUAL_FEE','TRANSFER_FEE','OTHER')),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('ATM_WITHDRAWAL','POS','ONLINE','TRANSFER','ANY')),
  region           TEXT NOT NULL CHECK (region IN ('CEMEA','NON_CEMEA','DOMESTIC','ANY')),
  amount_minor     BIGINT,
  amount_currency  TEXT,
  percent          NUMERIC,
  min_minor        BIGINT,
  max_minor        BIGINT,
  amount_is_range  BOOLEAN NOT NULL DEFAULT FALSE,
  currency         TEXT NOT NULL,
  effective_from   DATE NOT NULL,
  effective_to     DATE,
  source_id        TEXT NOT NULL REFERENCES financial_sources(id),
  confidence       TEXT NOT NULL CHECK (confidence IN ('VERIFIED','LIKELY','UNVERIFIED','UNKNOWN')),
  verified_at      DATE,
  is_ambiguous     BOOLEAN NOT NULL DEFAULT FALSE,
  ambiguity_note   TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (card_id IS NOT NULL OR issuer IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fee_rules_lookup ON fee_rules(issuer, product, transaction_type, region, effective_from);
CREATE INDEX IF NOT EXISTS idx_fee_rules_card ON fee_rules(card_id);

CREATE TABLE IF NOT EXISTS reference_rates (
  id             TEXT PRIMARY KEY,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate           NUMERIC NOT NULL CHECK (rate > 0),
  rate_type      TEXT NOT NULL CHECK (rate_type IN ('OFFICIAL','MID_MARKET','ISSUER','ATM_OFFERED','USER_ESTIMATE')),
  source_id      TEXT REFERENCES financial_sources(id),
  effective_date DATE NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_reference_rates_pair ON reference_rates(base_currency, quote_currency, effective_date DESC);

CREATE TABLE IF NOT EXISTS evidence (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('RECEIPT_PHOTO','SCREENSHOT','STATEMENT_PDF')),
  storage_key    TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  uploaded_by    TEXT NOT NULL REFERENCES users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  redaction_ack  BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id                  TEXT PRIMARY KEY,
  card_id             TEXT NOT NULL REFERENCES cards(id),
  amount_minor        BIGINT NOT NULL,
  currency            TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL,
  captured_local_time TEXT,
  source              TEXT NOT NULL CHECK (source IN ('BANK_APP','SMS','ATM_RECEIPT','STATEMENT','MANUAL')),
  balance_type        TEXT NOT NULL CHECK (balance_type IN ('AVAILABLE','LEDGER','UNKNOWN')),
  evidence_id         TEXT REFERENCES evidence(id),
  notes               TEXT,
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_card_time ON balance_snapshots(card_id, captured_at DESC);

-- The only thing that makes a non-dinar card's true dinar cost knowable.
CREATE TABLE IF NOT EXISTS funding_events (
  id                TEXT PRIMARY KEY,
  card_id           TEXT NOT NULL REFERENCES cards(id),
  credited_minor    BIGINT NOT NULL CHECK (credited_minor > 0),
  credited_currency TEXT NOT NULL,
  iqd_paid_minor    BIGINT,
  funding_fee_minor BIGINT,
  funding_fee_currency TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('BANK_APP','STATEMENT','RECEIPT','MANUAL')),
  evidence_id       TEXT REFERENCES evidence(id),
  notes             TEXT,
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_card ON funding_events(card_id, occurred_at);

CREATE TABLE IF NOT EXISTS day_closes (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id),
  close_date DATE NOT NULL,
  closed_at  TIMESTAMPTZ,
  closed_by  TEXT REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  snapshot   JSONB,
  UNIQUE (trip_id, close_date)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id                     TEXT PRIMARY KEY,
  idempotency_key        TEXT NOT NULL UNIQUE,
  trip_id                TEXT NOT NULL REFERENCES trips(id),
  card_id                TEXT NOT NULL REFERENCES cards(id),
  ownership              TEXT NOT NULL CHECK (ownership IN ('PERSONAL','COMPANY')),
  state                  TEXT NOT NULL CHECK (state IN ('DRAFT','CAPTURED','PENDING','POSTED','PARTIALLY_RECONCILED','RECONCILED','DISCREPANCY','REVERSED','DISPUTED','FAILED_ATM','PARTIAL_DISPENSE')),
  transaction_at         TIMESTAMPTZ NOT NULL,
  transaction_local_time TEXT,
  posting_date           DATE,

  atm_operator           TEXT,
  atm_location           TEXT,
  atm_terminal_id        TEXT,
  transaction_reference  TEXT,
  requested_sar_minor    BIGINT CHECK (requested_sar_minor IS NULL OR requested_sar_minor >= 0),
  dispensed_sar_minor    BIGINT NOT NULL CHECK (dispensed_sar_minor >= 0),
  atm_surcharge_minor    BIGINT,
  atm_surcharge_currency TEXT,
  surcharge_handling     TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (surcharge_handling IN ('INCLUDED_IN_DEBIT','POSTED_SEPARATELY','UNKNOWN')),

  dcc_offered            TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (dcc_offered IN ('YES','NO','UNKNOWN')),
  dcc_selection          TEXT CHECK (dcc_selection IN ('LOCAL_CURRENCY','BILLING_CURRENCY','UNKNOWN')),
  dcc_offered_rate       NUMERIC,
  dcc_markup_percent     NUMERIC,
  dcc_converted_minor    BIGINT,
  dcc_converted_currency TEXT,

  before_snapshot_id     TEXT REFERENCES balance_snapshots(id),
  after_snapshot_id      TEXT REFERENCES balance_snapshots(id),

  pending_debit_minor       BIGINT,
  pending_debit_currency    TEXT,
  pending_fee_minor         BIGINT,
  pending_description       TEXT,
  pending_at                TIMESTAMPTZ,

  posted_debit_minor              BIGINT,
  posted_debit_currency           TEXT,
  posted_bank_fee_minor           BIGINT,
  posted_international_fee_minor  BIGINT,
  posted_cash_withdrawal_fee_minor BIGINT,
  posted_other_fee_minor          BIGINT,
  statement_description           TEXT,
  posted_at                       TIMESTAMPTZ,

  receipt_evidence_id    TEXT REFERENCES evidence(id),
  notes                  TEXT,
  day_close_id           TEXT REFERENCES day_closes(id),
  voided_by_id           TEXT REFERENCES withdrawals(id),
  reversal_of_id         TEXT REFERENCES withdrawals(id),
  duplicate_warning_ack  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by             TEXT NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_trip_time ON withdrawals(trip_id, transaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_card_time ON withdrawals(card_id, transaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_state ON withdrawals(state);
CREATE INDEX IF NOT EXISTS idx_withdrawals_dupe ON withdrawals(card_id, dispensed_sar_minor, transaction_at);

-- Append-only history of every change to a pending or posted figure.
CREATE TABLE IF NOT EXISTS withdrawal_revisions (
  id             TEXT PRIMARY KEY,
  withdrawal_id  TEXT NOT NULL REFERENCES withdrawals(id),
  field          TEXT NOT NULL,
  previous_value TEXT,
  new_value      TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by     TEXT NOT NULL REFERENCES users(id),
  reason         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_withdrawal ON withdrawal_revisions(withdrawal_id, changed_at);

CREATE TABLE IF NOT EXISTS discrepancies (
  id                  TEXT PRIMARY KEY,
  withdrawal_id       TEXT NOT NULL REFERENCES withdrawals(id),
  expected_minor      BIGINT NOT NULL,
  observed_minor      BIGINT NOT NULL,
  difference_minor    BIGINT NOT NULL,
  currency            TEXT NOT NULL,
  confidence          TEXT NOT NULL,
  potential_causes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_classification TEXT CHECK (user_classification IN ('PENDING_HOLD','SEPARATE_ISSUER_FEE','ATM_SURCHARGE','OTHER_TRANSACTION','DELAYED_BALANCE_REFRESH','DCC','REVERSAL','ENTRY_ERROR','UNKNOWN')),
  classified_by       TEXT REFERENCES users(id),
  classified_at       TIMESTAMPTZ,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discrepancies_open ON discrepancies(withdrawal_id) WHERE user_classification IS NULL;

CREATE TABLE IF NOT EXISTS cash_wallets (
  id        TEXT PRIMARY KEY,
  trip_id   TEXT NOT NULL REFERENCES trips(id),
  ownership TEXT NOT NULL CHECK (ownership IN ('PERSONAL','COMPANY')),
  currency  TEXT NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  UNIQUE (trip_id, ownership)
);

CREATE TABLE IF NOT EXISTS cash_expenses (
  id                  TEXT PRIMARY KEY,
  trip_id             TEXT NOT NULL REFERENCES trips(id),
  ownership           TEXT NOT NULL CHECK (ownership IN ('PERSONAL','COMPANY')),
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  currency            TEXT NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  category            TEXT,
  purpose             TEXT,
  receipt_evidence_id TEXT REFERENCES evidence(id),
  spent_at            TIMESTAMPTZ NOT NULL,
  notes               TEXT,
  day_close_id        TEXT REFERENCES day_closes(id),
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id            TEXT PRIMARY KEY,
  wallet_id     TEXT NOT NULL REFERENCES cash_wallets(id),
  direction     TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  currency      TEXT NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  kind          TEXT NOT NULL CHECK (kind IN ('ATM_WITHDRAWAL','EXPENSE','ADJUSTMENT','TRANSFER')),
  withdrawal_id TEXT REFERENCES withdrawals(id),
  expense_id    TEXT REFERENCES cash_expenses(id),
  occurred_at   TIMESTAMPTZ NOT NULL,
  notes         TEXT,
  day_close_id  TEXT REFERENCES day_closes(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_wallet ON cash_movements(wallet_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_movement_per_withdrawal ON cash_movements(withdrawal_id) WHERE withdrawal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS corrections (
  id            TEXT PRIMARY KEY,
  target_table  TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  field         TEXT NOT NULL,
  previous_value TEXT,
  new_value     TEXT,
  reason        TEXT NOT NULL,
  day_close_id  TEXT REFERENCES day_closes(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES users(id),
  action         TEXT NOT NULL,
  entity_table   TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  previous_value JSONB,
  new_value      JSONB,
  reason         TEXT,
  request_id     TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_table, entity_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Invariants the database enforces itself, so that an application bug cannot
-- produce a financially incoherent row.
-- ---------------------------------------------------------------------------

-- A withdrawal's ownership must equal its card's ownership.
CREATE OR REPLACE FUNCTION trg_withdrawal_ownership() RETURNS TRIGGER AS $$
DECLARE card_owner TEXT;
BEGIN
  SELECT ownership INTO card_owner FROM cards WHERE id = NEW.card_id;
  IF card_owner IS DISTINCT FROM NEW.ownership THEN
    RAISE EXCEPTION 'Withdrawal ownership % does not match card ownership %', NEW.ownership, card_owner;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS withdrawal_ownership ON withdrawals;
CREATE TRIGGER withdrawal_ownership BEFORE INSERT OR UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION trg_withdrawal_ownership();

-- Pending figures are write-once for ordinary updates. The one legitimate way
-- to change them is the audited revision path in the service layer, which
-- writes a withdrawal_revisions row and an audit event in the same transaction
-- and marks that transaction with a local setting the trigger checks. A bare
-- UPDATE arriving any other way is refused.
CREATE OR REPLACE FUNCTION trg_pending_write_once() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_pending_revision', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.pending_debit_minor IS NOT NULL
     AND NEW.pending_debit_minor IS DISTINCT FROM OLD.pending_debit_minor THEN
    RAISE EXCEPTION 'Pending debit is write-once; record a withdrawal_revision instead';
  END IF;
  IF OLD.pending_fee_minor IS NOT NULL
     AND NEW.pending_fee_minor IS DISTINCT FROM OLD.pending_fee_minor THEN
    RAISE EXCEPTION 'Pending fee is write-once; record a withdrawal_revision instead';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pending_write_once ON withdrawals;
CREATE TRIGGER pending_write_once BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION trg_pending_write_once();

-- Cash may only enter a wallet whose ownership matches the source withdrawal,
-- and a withdrawal that dispensed nothing may not move cash at all.
CREATE OR REPLACE FUNCTION trg_cash_movement_guard() RETURNS TRIGGER AS $$
DECLARE w_owner TEXT; w_dispensed BIGINT; wallet_owner TEXT;
BEGIN
  SELECT ownership INTO wallet_owner FROM cash_wallets WHERE id = NEW.wallet_id;
  IF NEW.withdrawal_id IS NOT NULL THEN
    SELECT ownership, dispensed_sar_minor INTO w_owner, w_dispensed
      FROM withdrawals WHERE id = NEW.withdrawal_id;
    IF w_owner IS DISTINCT FROM wallet_owner THEN
      RAISE EXCEPTION 'Refusing to move % money into the % wallet', w_owner, wallet_owner;
    END IF;
    IF w_dispensed = 0 THEN
      RAISE EXCEPTION 'A withdrawal that dispensed no cash cannot move cash';
    END IF;
    IF NEW.amount_minor > w_dispensed THEN
      RAISE EXCEPTION 'Cash movement % exceeds cash dispensed %', NEW.amount_minor, w_dispensed;
    END IF;
  END IF;
  IF NEW.expense_id IS NOT NULL THEN
    IF (SELECT ownership FROM cash_expenses WHERE id = NEW.expense_id) IS DISTINCT FROM wallet_owner THEN
      RAISE EXCEPTION 'Expense ownership does not match wallet ownership';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_movement_guard ON cash_movements;
CREATE TRIGGER cash_movement_guard BEFORE INSERT OR UPDATE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION trg_cash_movement_guard();

-- Financial rows dated inside a closed day are soft-locked. A change after the
-- close must arrive as a correction row, which carries a reason and an actor.
CREATE OR REPLACE FUNCTION trg_soft_lock_closed_day() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.day_close_id IS NOT NULL
     AND (SELECT status FROM day_closes WHERE id = OLD.day_close_id) = 'CLOSED'
     AND NEW.day_close_id IS NOT DISTINCT FROM OLD.day_close_id THEN
    RAISE EXCEPTION 'This day is closed. Record a correction instead of editing closed history.';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS soft_lock_withdrawals ON withdrawals;
CREATE TRIGGER soft_lock_withdrawals BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION trg_soft_lock_closed_day();
