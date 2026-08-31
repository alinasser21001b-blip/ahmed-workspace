# DATA MODEL

**Date: 2026-08-31.** Schema of record: `src/server/db/schema.sql`.

Conventions used everywhere:

* **Money** = two columns: `*_minor BIGINT` + `*_currency TEXT`. Never `float`,
  never `numeric` for money. `IQD` scale 0, `USD`/`SAR` scale 2.
* **Rates** = `NUMERIC` (exact), always read as text and parsed into the exact
  rational `Rate`. Every rate row carries source, type and date.
* **Nullable money means UNKNOWN, never zero.** A researched zero is stored as an
  explicit `0` with a source; an unknown is `NULL` and propagates as
  undeterminable.
* Timestamps `timestamptz` (UTC) plus, on financial events, a local-time pair.
* Nothing is hard-deleted. `void`/`reversal`/`correction` records instead.

---

## 1. `users`
`id`, `email` (unique, citext-style lowercase), `password_hash` (Argon2id),
`role ∈ {TRAVELER, ADMIN}`, `display_name`, `locale ∈ {ar, en}`, `is_active`,
`created_at`.

`sessions`: `id`, `user_id`, `token_hash`, `csrf_token_hash`, `expires_at`,
`created_at`, `revoked_at`, `user_agent_hash`. Tokens are never stored in clear.

## 2. `trips`
`id`, `name`, `destination`, `start_date`, `end_date`,
`local_currency` (default `SAR`), `reporting_currency` (default `IQD`),
`local_timezone` (default `Asia/Riyadh`), `status ∈ {PLANNED, ACTIVE, CLOSED}`,
`notes`.

## 3. `cards`
`id`, `trip_id`, `nickname`, `issuer`, `product`,
`network ∈ {VISA, MASTERCARD, OTHER, UNKNOWN}`,
`card_type ∈ {DEBIT, CREDIT, PREPAID, CORPORATE, UNKNOWN}`,
`last4` — `CHECK (last4 ~ '^[0-9]{4}$')`,
`ownership ∈ {PERSONAL, COMPANY}`,
`native_currency ∈ {IQD, USD, SAR}`,
`opening_available_minor` + currency, `opening_ledger_minor` + currency (nullable
= unknown), `daily_atm_limit_minor`, `per_transaction_limit_minor`,
`international_monthly_limit_minor` (the CBI regulatory cap, §CBI-04 of the
research), `trip_allocation_minor`, `is_active`, `notes`,
and — a direct consequence of research record CBI-06 —
`international_status ∈ {CONFIRMED_WORKING, CLAIMED_BY_ISSUER, RESTRICTED_BY_REGULATION, UNKNOWN}`
with `international_status_evidence`.

**There is no column for PAN, PIN, CVV, OTP or any credential.** The schema
cannot store one.

## 4. `fee_rules` — effective-dated pricing profiles
`id`, `card_id` (nullable) **or** `issuer` + `product` (a template applying to a
product rather than one card), `rule_type ∈ {ATM_WITHDRAWAL_FEE, FX_FEE,
INTERNATIONAL_FEE, CASH_ADVANCE_FEE, ANNUAL_FEE, TRANSFER_FEE, OTHER}`,
`transaction_type ∈ {ATM_WITHDRAWAL, POS, ONLINE, TRANSFER, ANY}`,
`region ∈ {CEMEA, NON_CEMEA, DOMESTIC, ANY}`,
`amount_minor` + `amount_currency` (fixed component, nullable),
`percent` `NUMERIC` (nullable), `min_minor`, `max_minor`, `currency`,
`effective_from DATE NOT NULL`, `effective_to DATE` (null = open),
`source_id → financial_sources`, `confidence ∈ {VERIFIED, LIKELY, UNVERIFIED, UNKNOWN}`,
`verified_at`, `is_ambiguous BOOLEAN`, `ambiguity_note`, `notes`.

Two properties matter:

* **Historical immutability.** A withdrawal resolves its rules by
  `effective_from <= transaction_date AND (effective_to IS NULL OR effective_to >= transaction_date)`.
  Publishing a new tariff inserts a new row and closes the old one; it never
  updates it. Yesterday's transaction keeps yesterday's price.
  Test: `historical-fee-rules-immutable.test.ts`.
* **`min`/`max` with `is_ambiguous`** carries research record NEO-02's unresolved
  3,000–4,000 IQD range through to the UI as a range, with no midpoint guess.

## 5. `financial_sources`
`id`, `institution`, `title`, `url`, `source_class ∈ {PRIMARY, SECONDARY}`,
`accessed_at`, `published_at`, `retrieval_status ∈ {RETRIEVED, BLOCKED, SNIPPET_ONLY}`,
`notes`. Every seeded rule points at one. This is what makes a future tariff
change auditable against what was believed on 2026-08-31.

## 6. `balance_snapshots`
`id`, `card_id`, `amount_minor` + `currency`, `captured_at` (UTC),
`captured_local_time`, `source ∈ {BANK_APP, SMS, ATM_RECEIPT, STATEMENT, MANUAL}`,
`balance_type ∈ {AVAILABLE, LEDGER, UNKNOWN}`, `evidence_id` (nullable), `notes`,
`created_by`.

A snapshot with `balance_type = AVAILABLE` taken seconds after a withdrawal is
weaker evidence than a `STATEMENT` `LEDGER` reading days later, and the
reconciliation engine weights them accordingly rather than treating both as
final.

## 7. `withdrawals` — the central financial event
Identity and context: `id`, `idempotency_key` (**UNIQUE**), `trip_id`, `card_id`,
`ownership` (denormalised from the card and `CHECK`-constrained to match it —
this is the database-level guard against personal/company leakage),
`state`, `created_by`, `created_at`, `transaction_at` (UTC),
`transaction_local_time`, `posting_date` (nullable — differs from transaction
date routinely).

ATM event: `atm_operator`, `atm_location`, `atm_terminal_id`,
`requested_sar_minor`, `dispensed_sar_minor` — `CHECK (dispensed_sar_minor >= 0)`,
`atm_surcharge_minor` + `atm_surcharge_currency` (nullable = unknown).

DCC: `dcc_offered ∈ {YES, NO, UNKNOWN}`,
`dcc_selection ∈ {LOCAL_CURRENCY, BILLING_CURRENCY, UNKNOWN}` (null when not
offered), `dcc_offered_rate NUMERIC`, `dcc_markup_percent NUMERIC`,
`dcc_converted_amount_minor` + currency.

Balances: `before_snapshot_id`, `after_snapshot_id` (both nullable).

**Pending — write-once.** `pending_debit_minor` + currency, `pending_fee_minor`,
`pending_description`, `pending_at`. Guarded by a trigger: once non-null, an
`UPDATE` that changes a pending column is rejected. A revised pending value is a
new `withdrawal_revisions` row, not an overwrite.

**Posted — separate columns, never overwriting pending.**
`posted_debit_minor` + currency, `posted_bank_fee_minor`,
`posted_international_fee_minor`, `posted_cash_withdrawal_fee_minor`,
`posted_other_fee_minor`, `statement_description`, `posted_at`.

Other: `receipt_evidence_id`, `notes`, `day_close_id` (set when soft-locked),
`voided_by_id`, `reversal_of_id`, `duplicate_warning_ack`.

### 7.1 States
`DRAFT` → `CAPTURED` → `PENDING` → `POSTED` → `PARTIALLY_RECONCILED` →
`RECONCILED`, with the off-path terminals `DISCREPANCY`, `REVERSED`, `DISPUTED`,
`FAILED_ATM`, `PARTIAL_DISPENSE`. Transitions are validated by a table in
`src/core/states.ts`; an illegal transition is rejected by the API, not silently
coerced. Nothing collapses to "completed".

`FAILED_ATM` and `PARTIAL_DISPENSE` describe *what the machine did*; the
settlement states describe *where the money is*. A partial dispense still
progresses through `PENDING`/`POSTED`, which is why they are recorded as a state
plus the dispensed amount rather than as a state alone.

## 8. `withdrawal_revisions`
Append-only history of pending/posted figures: `withdrawal_id`, `field`,
`previous_value`, `new_value`, `changed_at`, `changed_by`, `reason`. This is what
lets settlement update the picture while satisfying "pending updates do not
overwrite original pending values without audit history".

## 9. `cash_wallets` and `cash_movements`
`cash_wallets`: `id`, `trip_id`, `ownership ∈ {PERSONAL, COMPANY}`,
`currency` — `CHECK (currency = 'SAR')`, `UNIQUE (trip_id, ownership)`.

`cash_movements`: `id`, `wallet_id`, `direction ∈ {IN, OUT}`, `amount_minor`,
`kind ∈ {ATM_WITHDRAWAL, EXPENSE, ADJUSTMENT, TRANSFER}`, `withdrawal_id`
(nullable), `expense_id` (nullable), `occurred_at`, `created_by`, `notes`.

**The accounting principle, encoded.** A company ATM withdrawal creates an `IN`
movement on the company wallet of kind `ATM_WITHDRAWAL`. It is a **transfer**:
the company card asset falls, company cash rises. It is *not* an expense, and the
UI label is "Company Cash Withdrawn". Expense only ever arises from
`cash_expenses`. A trigger enforces that a movement's wallet ownership equals the
source withdrawal's ownership — personal money cannot enter the company wallet.

`cash_expenses` (optional, separate from the core flow): `id`, `trip_id`,
`ownership`, `amount_minor` (SAR), `category`, `purpose`, `receipt_evidence_id`,
`spent_at`, `notes`.

Expected cash on hand = Σ `IN` − Σ `OUT` per wallet, and it is a *derived* figure
labelled as such.

## 10. `funding_events`
`id`, `card_id`, `credited_minor` + `credited_currency` (the card's native
currency), `iqd_paid_minor` (nullable), `funding_fee_minor` + currency,
`occurred_at`, `source ∈ {BANK_APP, STATEMENT, RECEIPT, MANUAL}`, `evidence_id`,
`notes`.

Actual funding cost per native unit = `(iqd_paid + funding_fee) / credited`, an
exact rational. **This is the only thing that unlocks a real economic IQD cost for
a USD card** (research §9.2). With no funding event, economic IQD cost is not
computed and the UI reads "Not enough evidence".

## 11. `reference_rates`
`id`, `base_currency`, `quote_currency`, `rate NUMERIC`,
`rate_type ∈ {OFFICIAL, MID_MARKET, ISSUER, ATM_OFFERED, USER_ESTIMATE}`,
`source_id`, `effective_date`, `fetched_at`, `notes`.

`rate_type` is required, so a mid-market cross-rate can never be displayed as an
official CBI rate. No reference rate is ever labelled an actual withdrawal rate;
the UI shows reference and settled side by side with the difference between them.

## 12. `evidence`
`id`, `kind ∈ {RECEIPT_PHOTO, SCREENSHOT, STATEMENT_PDF}`, `storage_key`,
`content_hash`, `uploaded_by`, `uploaded_at`, `redaction_ack BOOLEAN NOT NULL`.
Private storage, signed short-lived URLs, never a public bucket.
`redaction_ack` records that the uploader confirmed the image shows no full PAN,
CVV or PIN. **No OCR writes a financial field**; if OCR is ever added it may only
pre-fill a form the user must confirm.

## 13. `day_closes`
`id`, `trip_id`, `close_date`, `closed_at`, `closed_by`, `status ∈ {OPEN, CLOSED}`,
and a JSON `snapshot` capturing, per card, the confirmed balance, the system
expected balance, the difference, pending and unsettled transactions, SAR
withdrawn that day and remaining configured allowance; and per wallet, cash in,
expenses and expected remaining.

Closing soft-locks every financial row dated that day. A later correction is a
`corrections` row referencing the original — closed history is never silently
mutated.

## 14. `corrections`
`id`, `target_table`, `target_id`, `field`, `previous_value`, `new_value`,
`reason NOT NULL`, `created_by`, `created_at`, `day_close_id`.

## 15. `audit_events`
`id`, `actor_user_id`, `action`, `entity_table`, `entity_id`,
`previous_value JSONB`, `new_value JSONB`, `reason`, `occurred_at`,
`request_id`. Written **inside the same transaction** as the change it records,
so an audit gap is impossible by construction.

## 16. `discrepancies`
`id`, `withdrawal_id`, `expected_minor` + currency, `observed_minor` + currency,
`difference_minor`, `confidence`, `potential_causes JSONB`,
`user_classification ∈ {PENDING_HOLD, SEPARATE_ISSUER_FEE, ATM_SURCHARGE,
OTHER_TRANSACTION, DELAYED_BALANCE_REFRESH, DCC, REVERSAL, ENTRY_ERROR, UNKNOWN}`
(nullable until the user classifies), `classified_by`, `classified_at`,
`resolution_note`.

**Never auto-resolved.** The engine proposes ranked potential causes; only a user
may classify, and an unclassified non-zero difference stays visible on the
dashboard.

---

## 17. Confidence and provenance vocabularies

**Provenance** (where a number came from): `BANK_APP`, `BANK_STATEMENT`,
`ATM_RECEIPT`, `OFFICIAL_TARIFF`, `USER_ENTRY`, `DERIVED_CALCULATION`,
`REFERENCE_RATE`.

**Pricing confidence** (how settled a withdrawal's cost is): `ESTIMATED` →
`OBSERVED` → `PENDING` → `POSTED` → `VERIFIED` → `RECONCILED`. Only `RECONCILED`
and `VERIFIED` feed the Best Card engine.

**Rule confidence** (how good the tariff evidence is): `VERIFIED`, `LIKELY`,
`UNVERIFIED`, `UNKNOWN` — defined in `FINANCIAL-RESEARCH.md` §2.

## 18. Invariants enforced in the database

1. `dispensed_sar_minor >= 0`.
2. A withdrawal's `ownership` equals its card's `ownership`.
3. A cash movement's wallet ownership equals its source withdrawal's ownership.
4. Cash wallet currency is `SAR`.
5. `last4` is exactly four digits; no credential column exists.
6. `idempotency_key` is unique.
7. Pending columns are write-once (trigger).
8. A failed dispense (`dispensed = 0`) cannot produce a cash movement (trigger).
9. A reversal references its original and never deletes it (FK + no cascade delete).
10. Money columns are `BIGINT`; there is no `float` column in the schema.
