# ARCHITECTURE

**Date: 2026-08-31**

## 1. What this system is

A private, mobile-first travel treasury for one traveller and one administrator,
handling **real money** that is partly personal and partly company-owned. It is
three connected ledgers, not a transaction list:

1. **Card ledger** — what remains on each card, in that card's own currency.
2. **SAR cash treasury** — physical riyals actually in hand, split
   `PERSONAL` / `COMPANY`.
3. **Settlement/reconciliation ledger** — the explanation of how value moved from
   a card balance to physical cash, and what fees and FX happened in between.

The design constraint that dominates every other one: **the system must never
look more certain than its evidence.** Section 9 of `FINANCIAL-RESEARCH.md`
establishes that essentially no issuer tariff could be verified, so the
application's trustworthy numbers must come from what the traveller actually
measures — not from what a bank's marketing page says.

## 2. Environment survey (done before choosing)

The repository already hosts several projects. The most relevant, `student-os`,
is a pnpm + TypeScript monorepo deploying a Fastify API as a Netlify function
beside a static client, with Postgres. Node 22 and pnpm 10.33 are present;
`npm` reaches the registry; **all other outbound HTTP is blocked** by egress
policy. No Docker daemon or Postgres server is available in-session.

Two conclusions followed directly:

* Postgres is the right database — it matches the house style, and the product
  genuinely needs real transactions and constraints.
* It must be runnable **without a database server**, or nothing could be tested
  here. `@electric-sql/pglite` (Postgres compiled to WASM, in-process) was probed
  and confirmed to enforce `CHECK` constraints, roll back failed transactions,
  and provide exact `NUMERIC`. Same SQL, no server.

## 3. Stack, and why

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict), Node 22 | House standard; the type system is load-bearing here — `Money`, `Evidenced<T>` and currency tags are enforced at compile time, not by convention. |
| Domain engine | Plain TypeScript, **zero runtime dependencies** | The financial core must be auditable line by line and trivially testable. No framework may sit between the reader and the arithmetic. |
| Money arithmetic | **`bigint` integer minor units**, exact rational rates | No floating point anywhere in a money path — enforced by a test that scans the compiled core for `Number`/float operations on money types. A decimal library was considered and rejected: `bigint` is built in, exact, and removes a supply-chain dependency from the most safety-critical code in the system. |
| Database | PostgreSQL — `@electric-sql/pglite` locally and in tests, `pg` against Neon/any Postgres in production | Real transactional semantics with no server requirement. One SQL dialect for both. |
| Data access | Hand-written SQL behind a small `Db` port | An ORM would obscure exactly the transactional boundaries that matter most. The SQL is short and the constraints are the point. |
| API | Fastify | Small, fast, good validation story, already proven in this repository. |
| Client | React + Vite, installable PWA | Fast on a phone, works offline for draft capture, no app-store round trip. |
| Tests | Vitest | Already the repository's test runner. |
| Deployment | Static client + API, Netlify-shaped (same-origin), Postgres via Neon | Matches `student-os`, so the operational knowledge already exists in this repo. |

**Not chosen, deliberately:** a monorepo (the layering is enforced by an
import-boundary test instead of by package plumbing — same guarantee, far less
machinery); an ORM; a decimal library; any client-side FX API; server-side OCR.

## 4. Layering

```
src/core/     pure domain. No I/O, no framework, no Date.now() at rest.
   ↑
src/server/   Fastify + SQL. Owns transactions, auth, audit, idempotency.
   ↑
src/web/      React PWA. Renders; never calculates money.
```

The dependency arrow points one way only. `test/architecture.test.ts` fails the
build if `core` imports from `server` or `web`, if `web` imports the SQL layer,
or — most importantly — **if any money formula appears outside `core`**. The task
requires one canonical implementation of every rate calculation; this test is
what makes that true rather than aspirational.

## 5. The three ideas the engine is built on

### 5.1 `Money` — integer minor units, currency-tagged

`Money` is `{ minor: bigint, currency: CurrencyCode }`. `IQD` has scale 0 (whole
dinars, as Iraqi bank statements show them), `USD` and `SAR` scale 2.

Addition and subtraction of different currencies **throw**. There is no implicit
conversion anywhere. Converting requires an explicit `Rate`, which carries its
own `from`/`to` currencies and its own provenance — so a currency change is
always an auditable act, never a side effect. This is the invariant "money never
changes currency without an explicit conversion basis", enforced by the type
system first and tests second.

### 5.2 `Rate` — exact rational, never a float

`Rate` is `{ num: bigint, den: bigint, from, to }`. `388000 IQD / 1000 SAR`
is stored as exactly that ratio, not as `388.0`. Rounding happens only at
display, with an explicit mode. An effective rate of `371.4166…` never becomes a
float — it stays exact, and the UI decides how many places to show.

### 5.3 `Evidenced<T>` — the mechanism that makes "unknown never becomes zero" real

Every calculated financial figure is:

```ts
type Evidenced<T> =
  | { known: true;  value: T; provenance: Provenance; confidence: Confidence; basis: string }
  | { known: false; reason: string; missing: string[] }
```

Arithmetic over `Evidenced` propagates unknown-ness: an unknown fee makes the
all-in cost unknown, which makes the effective rate unknown, which makes the UI
say *"Cannot determine verified effective rate yet"* — with `missing` naming
exactly what evidence would resolve it. There is no code path that turns
`known: false` into `0`. That is the product's central promise, expressed as a
type.

`Provenance` (`BANK_APP`, `BANK_STATEMENT`, `ATM_RECEIPT`, `OFFICIAL_TARIFF`,
`USER_ENTRY`, `DERIVED_CALCULATION`, `REFERENCE_RATE`) travels with every value,
so the UI can never present a derived number as bank-provided.

## 6. Transactional integrity

Every financial write goes through one `db.transaction()` that commits, together
or not at all:

* the financial event (withdrawal / settlement / correction),
* every ledger effect (card ledger, cash treasury),
* the audit record.

There is no code path that writes a monetary row outside a transaction; the
repository layer only exposes transaction-scoped methods. Money columns are
`BIGINT` minor units with `CHECK` constraints (cash dispensed cannot be
negative; a wallet's currency must be SAR; a company withdrawal cannot credit a
personal wallet). The database refuses the invariant violation even if
application code were wrong.

**Idempotency.** Every write carries a client-generated `idempotency_key`, unique
in the database. A retried offline sync re-presents the same key and receives the
original result rather than creating a second withdrawal. Duplicate *detection*
(same card, similar time, same amount) is separate and advisory — it warns, it
does not block, because two genuine identical withdrawals are possible.

**Soft-lock, never mutate.** Closing a day soft-locks its entries. Corrections
after that are new `correction` records that reference the original; the original
rows are never rewritten. Pending values are stored in their own columns and are
never overwritten by settlement — posted values land beside them.

## 7. Security posture

* Argon2id password hashing; opaque session tokens hashed at rest; HttpOnly,
  `SameSite=Strict`, `Secure` cookies.
* Two roles: `TRAVELER` and `ADMIN`, enforced server-side per route.
* CSRF double-submit token on all mutating routes; rate limiting on auth.
* Strict security headers and a CSP with no inline script.
* **No card credential may enter the system**: the schema stores `last4` only,
  with a `CHECK` constraint of exactly four digits, and there is no column
  anywhere for PAN, PIN, CVV, OTP or bank password. Request logging redacts
  bodies on financial routes.
* Receipt images, if enabled, are private with signed short-lived URLs; the
  upload screen warns against uploading anything showing a full PAN.
* OCR is explicitly not implemented as a decision path — see `DATA-MODEL.md` §12.

## 8. Offline behaviour

The client is a PWA with a service worker. A withdrawal captured without
connectivity is stored locally as an `OFFLINE_DRAFT` with its idempotency key
already assigned, and replayed on reconnect. Conflicts are surfaced to the user,
never auto-resolved.

## 9. Time

All timestamps are stored UTC (`timestamptz`). Every financial event additionally
stores the **Saudi local time** it happened at and its IANA zone, because a
withdrawal at 01:00 Riyadh time belongs to the previous travel day in the
traveller's head and the Daily Close must agree with the traveller. Transaction
date and posting date are separate columns — they routinely differ.

## 10. What this architecture refuses to do

* Fetch exchange rates automatically (`FINANCIAL-RESEARCH.md` §11).
* Estimate a DCC cost — if DCC was taken, the cost is measured, not modelled.
* Rank cards on advertised tariffs.
* Auto-resolve a discrepancy, or hide one.
* Hard-delete a financial row.
