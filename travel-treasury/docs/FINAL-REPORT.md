# FINAL DELIVERY REPORT — Travel Treasury & Card Reconciliation System

**Date: 2026-08-31 · Branch: `claude/travel-treasury-card-reconciliation-8m3r8w`**

## 1. Research — what was verified, what remains unknown

Full detail: `docs/FINANCIAL-RESEARCH.md`. Summary:

* **Retrieval constraint, recorded honestly:** all direct HTTP to primary
  sources (cbi.iq, neo.iq, nbi.iq, qi.iq, sama.gov.sa, visa.com, mastercard.com)
  was blocked by the environment's egress policy. Research ran through a search
  index only, so **no issuer fee ships above `LIKELY` confidence**, and the app
  treats every seeded tariff as an estimate requiring issuer confirmation.
* **Structural findings that shaped the build:**
  * NEO issues an IQD product (**NEO 964**) and USD products (Classic/Platinum/
    Virtual) — the engine never lets one masquerade as the other.
  * NEO international FX fee: **2% inside Visa CEMEA / 2.5% outside** — Saudi
    Arabia is inside CEMEA, so 2% is the applicable tier. NEO 964 international
    ATM fee published as a **3,000–4,000 IQD range**, carried as a range.
  * NBI tariff shows **10,000 IQD** for ATMs "outside the national network" —
    scope ambiguous (other Iraqi banks vs abroad), flagged, not assumed. NBI's
    foreign-transaction percentage was **not found → UNKNOWN**.
  * Rafidain/Qi publishes **no** international ATM fee, FX mechanism or limits
    → all UNKNOWN; the marketed "guaranteed rate" has no published value.
  * **CBI-06 (highest operational risk):** reported CBI directive halting
    Mastercard international use from 2025-06-01. If it covers the Qi
    Mastercard, that card may not work in Saudi Arabia at all. Modelled as the
    per-card `internationalStatus` field; the planner refuses unconfirmed cards.
  * **CBI-04:** monthly regulatory caps on card use abroad (basic $5,000/card;
    travel $20,000; medical $50,000; retirees $10,000) — modelled as a separate
    planner constraint above issuer limits.
  * Traveller **cash** allowance cut to $2,000/month (2026-07-08, reported) —
    recorded as a cash rule, kept distinct from card rules.
  * No CBI SAR/IQD official rate was established → the app ships **no**
    SAR/IQD reference; the user enters one with source and type, and it is
    displayed beside — never instead of — their actual settled rate.
* **No automated rate fetching** (fragile-scrape ban respected); all
  calculations work with no FX feed because they derive from the traveller's
  own measurements.

## 2. Architecture

TypeScript strict / Node 22. Pure domain core (`src/core`, zero runtime
dependencies) → transactional Fastify server (`src/server`) → Arabic-first
React PWA (`src/web`). Postgres via PGlite in-process (dev/test/single-user
deploy) or any hosted Postgres via `DATABASE_URL` — same SQL, same triggers.
Layering is enforced by tests, not convention: core cannot import I/O, the web
layer cannot compute money, and every rate calculation has exactly one
implementation. Full rationale: `docs/ARCHITECTURE.md`.

## 3. Financial model

* **Money** = `bigint` minor units (IQD scale 0, SAR/USD 2). No floats.
* **Rates** = exact rationals; rounding only at display.
* **`Evidenced<T>`** wraps every derived figure with provenance
  (BANK_APP … DERIVED_CALCULATION), confidence
  (ESTIMATED→OBSERVED→PENDING→POSTED→VERIFIED→RECONCILED) and a translatable
  basis; unknowns carry the exact missing evidence. Unknown ≠ 0, by type.
* **Three IQD costs, never mixed:** native cost (always, once observed);
  reference IQD cost (labelled, needs a stored reference rate); economic IQD
  cost (only with a `FundingEvent` establishing what the card's currency really
  cost in dinars).
* **Three ledgers:** card ledger, SAR cash treasury (personal/company, never
  commingled — DB-enforced), and the settlement/reconciliation trail
  (observed vs pending vs posted, each preserved separately).
* A company withdrawal is recorded and labelled a **transfer** ("نقد الشركة
  المسحوب"), never an expense; expenses exist only as explicit cash-expense
  entries.
* Reconciliation proposes ranked causes; **only a person classifies**; nothing
  auto-resolves; unexplained differences stay visible.
* Best-card ranking and the planner run on **reconciled evidence only**; the
  planner enforces balance, daily, per-transaction, ATM and CBI-monthly
  constraints, refuses unusable cards with reasons, and always carries the
  planning disclaimer.

## 4. Security

Argon2id passwords; opaque hashed session tokens; HttpOnly/Secure/
SameSite=Strict cookie; CSRF double-submit on all writes; login rate limiting;
strict security headers + CSP; RBAC (TRAVELER/ADMIN, admin-only audit and rule
authoring); request bodies never logged on financial routes; last-4-only card
data with a DB CHECK, and no schema location where a PAN/PIN/CVV/OTP could be
stored; audit events written in the same transaction as every financial change;
idempotency keys make retries and offline replays safe. Evidence/receipt
storage was left un-implemented rather than implemented insecurely — the data
model (`evidence` table with `redaction_ack`) is ready for a private bucket
with signed URLs.

## 5. Validation executed

* **134 automated tests, all passing** (`npm test`):
  * The eight mandated scenarios exactly: IQD 388,000/388; separate-fee
    380,000+8,000→388; pending 382,000 preserved beside posted 387,250; USD
    card refusing an IQD cost without funding then yielding 359,100 IQD /
    359.10 with it; failed ATM (no ÷0 rate, no treasury credit); partial
    dispense costed on 3,000 not 5,000; reversal preserving both events;
    duplicate detection + idempotent writes.
  * Invariant suite: currency changes require explicit basis; reconciled ⇒ no
    unexplained difference; dispensed ≥ 0; failed dispense can't fund cash;
    ownership can't leak either direction; historical tariffs immutable under
    new tariffs; reversals never delete; pending write-once outside audited
    revisions; illegal state transitions rejected.
  * Database-level: triggers verified to refuse ownership leaks, cash from a
    zero dispense, closed-day edits, bare pending overwrites; whole-transaction
    rollback proven.
  * API lifecycle (23 tests) + USD lifecycle (4) through real HTTP: login/CSRF/
    headers → cards → withdrawal → duplicate 409 → pending → settle → audited
    revision → reconcile → discrepancy classify → failed ATM → company cash →
    expense → planner → comparison → day close soft-lock → corrections → CSV
    totals → audit trail completeness.
* **Browser E2E (Playwright, 390×844, Arabic):** 13 journeys through the built
  PWA — RTL login through card setup, quick withdrawal, settlement,
  reconciliation to مُطابَقة, dashboard, planner refusal reasons, comparison,
  daily close, sources — no console errors. Screenshots captured.
* **Production build smoke test:** compiled `dist-server` + built PWA booted
  with bootstrap env accounts, migrated, logged in over HTTP.

## 6. Deployment

* **Status: packaged and verified, not deployed** — no production hosting
  credentials/site were designated in this session, and deploying a real-money
  system to an unrequested host was not appropriate to decide unilaterally.
* Ship path (single container, `Dockerfile` at project root): build → run with
  four bootstrap env vars → HTTPS in front → daily backup of `/data` or the
  hosted database. `DATABASE_URL` switches to hosted Postgres with no code
  change. README has the exact commands.

## 7. Remaining risks — requires direct issuer confirmation

Ordered by impact (§10 of the research doc, mirrored in-app under المصادر المالية):

1. Whether the **Qi Mastercard works at Saudi ATMs at all** (CBI directive).
2. Rafidain/Qi international ATM fee, FX mechanism and limits — all UNKNOWN.
3. NBI foreign-transaction commission — UNKNOWN and cost-dominating.
4. NBI 10,000 IQD fee scope (domestic other-bank vs international).
5. NEO USD-product ATM fee (the researched fee is for the 964 card only);
   whether the 650 USD ceiling is per-transaction or per-day; the 3,000 vs
   4,000 IQD trigger.
6. Effective dates for every tariff; the traveller's CBI monthly category.
7. First withdrawals should be small until each card's behaviour is measured —
   the app's whole design is to turn those first settlements into verified
   rates.
