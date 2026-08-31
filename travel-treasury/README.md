# خزينة السفر — Travel Treasury & Card Reconciliation

A private, mobile-first, Arabic-first system for managing real SAR cash
withdrawals in Saudi Arabia funded by multiple Iraqi-issued cards — a travel
treasury, multi-card ledger and FX reconciliation system, not an expense
tracker. Every important number can explain where it came from, and the system
never looks more certain than its evidence.

## Documents

| Doc | What it holds |
|---|---|
| `docs/FINANCIAL-RESEARCH.md` | The evidence base: CBI, NEO, NBI, Rafidain/Qi, Visa/Mastercard, Saudi ATM context — every rule with source, date and confidence, and what remains UNKNOWN |
| `docs/ARCHITECTURE.md` | Stack and the three ideas the engine rests on (integer money, exact rates, `Evidenced<T>`) |
| `docs/DATA-MODEL.md` | Every entity, state machine, and the invariants the database enforces itself |
| `docs/FINAL-REPORT.md` | Delivery report: what was verified, tested, and what still needs the banks |

## Run locally

```bash
npm install
npm run build:web        # builds the PWA into dist/
npm run dev              # Fastify + in-process Postgres (PGlite) on :8787
# dev sign-in: traveler@local / traveler-dev-password
#              admin@local    / admin-dev-password
```

## Tests

```bash
npm test                 # 134 tests: money engine, invariants, schema triggers, API lifecycle
npm run typecheck
```

## Deploy (single container)

```bash
docker build -t travel-treasury .
docker run -p 8080:8080 -v tt-data:/data \
  -e BOOTSTRAP_TRAVELER_EMAIL=... -e BOOTSTRAP_TRAVELER_PASSWORD='...' \
  -e BOOTSTRAP_ADMIN_EMAIL=...    -e BOOTSTRAP_ADMIN_PASSWORD='...' \
  travel-treasury
```

* Default storage is embedded Postgres (PGlite) on the `/data` volume — right
  for a single-family private deployment. Set `DATABASE_URL` to use hosted
  Postgres (Neon etc.) instead.
* Put it behind HTTPS (the session cookie is `Secure`).
* Back up `/data` (or the hosted database) daily; it is the financial record.

## Non-negotiables encoded in this system

* Money is integer minor units (`bigint`); no float ever touches a money path.
* `UNKNOWN` never becomes zero — an underivable figure says what evidence is missing.
* Personal and company cash never mix; the database refuses the write.
* Pending figures are write-once outside the audited revision path.
* A closed day is soft-locked; corrections are new, reasoned records.
* Card data is last-4-only; the schema has no column a PAN or PIN could live in.
