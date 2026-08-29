# Deployment runbook — osce-production

Everything that can be done short of the deploy itself has been done. This file
is the remaining sequence, written so it can be executed in one sitting once the
account blocker clears.

**What was and was not touched, precisely:**

- **Not deployed.** No Worker was created, updated or deleted.
- **Not created.** No R2 bucket, no D1 database, no secret, no domain.
- **Read.** D1 databases, R2 buckets (denied), Workers, and the D1 schema and
  row counts were listed under the owner's authorization to proceed.
- **Modified.** One thing: migration `0005` was applied to the existing, empty
  D1 database `osce-knowledge-production`, and recorded in `d1_migrations`.
  Five temporary probe rows were inserted to verify the new constraints and
  then deleted; the database was left with zero rows in every table, as it was
  found. This is written up under "Migration 0005" below, because it caught a
  defect that a clean typecheck, build and dry-run had all missed.

---

## Verified Cloudflare state

Read directly from the account on 2026-08-29 via the Cloudflare connector.
Everything below is observed, not inferred from the brief.

| Resource | State |
|---|---|
| D1 `osce-knowledge-production` | **Exists.** `d585d340-869f-4482-8871-91053f1eb8b0`, matching `wrangler.jsonc`. All 14 tables and 10 indexes present. |
| D1 migrations | `0001`–`0004` applied 2026-08-29 11:13. **`0005` applied and recorded** during preparation — see below. |
| D1 contents | **Empty.** Zero rows in every table: no documents, questions, examiners, occurrences, sessions or answers. |
| R2 | **Disabled.** `r2_buckets_list` returns `403 / 10042 — "Please enable R2 through the Cloudflare Dashboard."` |
| R2 bucket `osce-documents-production` | **Does not exist**, and cannot be created until R2 is enabled. |
| Worker `osce-production` | **Not deployed.** The account holds two unrelated Workers (`adlytic-dashboard`, `rasad-ads-dashboard`). |

### The one remaining blocker

**R2 is not enabled on the account.** Only the account owner can enable it, in
the Cloudflare Dashboard, and it is a plan and billing decision rather than a
technical one. `wrangler.jsonc` binds `DOCUMENTS` to an R2 bucket, so until R2
is on:

- the bucket cannot be created,
- the Worker cannot bind it,
- document upload has nowhere to store the original file.

Nothing else stands in the way. Deployment itself additionally needs a wrangler
session (`npx wrangler login`, or a `CLOUDFLARE_API_TOKEN`), which the
preparing session did not have and the read-only connector does not provide.

### Migration 0005 was applied and exercised against the real database

Because the database was empty, `0005` was applied statement by statement
against production D1 and then recorded in `d1_migrations`, so
`wrangler d1 migrations apply` will correctly skip it.

**Doing this caught a defect that would have broken every publish.** The
migration originally created the fingerprint index as a *partial* unique index
(`... WHERE fingerprint IS NOT NULL`). SQLite refuses a partial index as an
`ON CONFLICT` target with a bare column list:

```
ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
```

The publish route issues exactly that statement, so it would have thrown at
runtime — after a clean typecheck, a clean build and a clean dry-run. The index
is now non-partial, which is equivalent for this purpose because SQLite already
treats NULLs as distinct in a unique index. `test/migrations.test.ts` applies
every migration to an in-memory database and runs the application's own
statements against it; reintroducing the partial index makes that suite fail
with the error above.

Both behaviours were then confirmed on production D1 and the probe rows removed:

| Probe | Result |
|---|---|
| Insert an occurrence with a fingerprint | `changes: 1` |
| Replay the same fingerprint | `changes: 0` — idempotent |
| Two occurrences with `NULL` fingerprints | both accepted — legacy rows safe |
| Record an answer | `changes: 1` |
| Resubmit the same session question | `changes: 0`, first answer preserved |

The database was left with zero rows in every table.

---

## State verified locally before you start

Run on Node 24 or newer (see the note at the end — this matters):

```bash
npm ci
npm run validate          # test + typecheck + lint
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-dry
```

Last recorded results:

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| Tests | 25 of 27 passing on Node 22; the 2 failures are the PDF tests and are a Node-version artefact, not a regression — see the note below |
| `vinext build` | succeeds; 9 routes emitted |
| `wrangler deploy --dry-run` | succeeds; 2486 KiB upload, 748 KiB gzipped; bindings resolve to `DB`, `DOCUMENTS`, `ASSETS` |

---

## Sequence

### 1. Confirm authorization

Get the owner's explicit go-ahead, in writing, to resume the Cloudflare cutover.
The brief halted it; only the owner lifts that.

### 2. Clear the account blocker

The owner completes Cloudflare account email and security verification, then
enables R2. **Review R2 billing terms with the owner before enabling** — the
brief flags this and it is a spend decision, not a technical one.

Confirm R2 is live before continuing:

```bash
npx wrangler r2 bucket list
```

If this still returns `10042`, R2 is not enabled and step 4 will fail. Stop here.

### 3. List before you create

Already done once and recorded above, but repeat it — the account may have moved
since. Never create a resource that may already exist:

```bash
npx wrangler d1 list
npx wrangler r2 bucket list
npx wrangler deployments list --name osce-production   # expect: not found
```

Expected state, as verified above:

- `osce-knowledge-production` **exists**, id `d585d340-869f-4482-8871-91053f1eb8b0`,
  migrations `0001`–`0005` applied, all tables present, zero rows. Do not
  recreate it. Confirm the id matches `wrangler.jsonc`.
- `osce-documents-production` does **not** exist.
- Worker `osce-production` does **not** exist.

If anything differs, stop and reconcile against read-only listings before making
a change.

### 4. Create only what is missing

```bash
npx wrangler r2 bucket create osce-documents-production
```

### 5. Set the admin secret

Interactively, so the value never reaches a shell history, a log, a command
argument, or this repository:

```bash
npx wrangler secret put ADMIN_KNOWLEDGE_TOKEN
```

Generate it with a real random source (`openssl rand -base64 32`). The
`requireAdmin` guard returns `503` when the secret is unset and `401` when it is
set but the supplied token is wrong, so a `503` after deployment means this step
was missed.

### 6. Apply migrations

Check status first, then apply. Migration `0005` is new in this change and is
additive — it adds a nullable column, two indexes, and two recomputation
statements that are safe to re-run.

```bash
npm run db:migrate:status        # expect 0001-0005 already applied
npm run db:migrate:production    # expect "no migrations to apply"
```

`0005` was applied during preparation and recorded in `d1_migrations`, so this
step should be a no-op. If it reports `0005` as pending, the tracking row is
missing — stop and reconcile before applying, because `ALTER TABLE ADD COLUMN`
is not idempotent and will fail on a second run.

### 7. Deploy

```bash
npm run deploy      # validate + build + migrate + wrangler deploy --strict
```

Capture the `workers.dev` URL it prints.

**Leave the ChatGPT-hosted site untouched.** It stays as production and as the
rollback target until the new deployment has passed step 8.

### 8. Acceptance on the hosted deployment

Repeat the full suite against the real deployment, not against local dev. Every
row must pass before the new URL is treated as production.

| # | Check | Pass condition |
|---|---|---|
| 1 | Upload TXT, MD, DOCX | Candidates extracted with provenance |
| 2 | Upload a text PDF | Page markers present; candidates carry page numbers |
| 3 | Upload a bilingual PDF | Arabic and English both extracted |
| 4 | Upload a scanned PDF | `OCR_REQUIRED`, **zero** candidates created |
| 5 | R2 persistence | Object present in `osce-documents-production` after upload |
| 6 | Review actions | Edit, approve, reject, merge all persist |
| 7 | Publish | Knowledge appears to a student with no redeploy |
| 8 | **Publish twice** | `question_occurrences` gains no duplicate row; `observation_count` unchanged (new — see below) |
| 9 | **Observation counts** | `examiner_questions.observation_count` is non-zero after publishing (new — this was always 0 before) |
| 10 | Grounded evaluation | A partial answer returns `PARTIAL` with only approved missing points |
| 11 | **Negation** | "there is no evidence of X" does **not** credit X (new) |
| 12 | **Resubmission** | Answering the same question twice returns `409 ALREADY_ANSWERED` (new) |
| 13 | Self-score fallback | A question with no approved key completes under `SELF` scoring |
| 14 | Answer secrecy | Key points absent from every pre-submission payload |
| 15 | Cross-session rejection | A question id from another session returns `409` |
| 16 | Admin auth | No token → `401`; wrong token → `401`; unset secret → `503` |
| 17 | Security headers | `public/_headers` applied; hashed assets immutably cached |
| 18 | Browser console | Zero errors across the student and admin flows |
| 19 | Production logs | No unexpected entries; no secret material present |

Queries for rows 8 and 9:

```bash
npx wrangler d1 execute osce-knowledge-production --remote \
  --command "SELECT COUNT(*) total, COUNT(DISTINCT fingerprint) distinct_fp FROM question_occurrences WHERE fingerprint IS NOT NULL"
# total must equal distinct_fp

npx wrangler d1 execute osce-knowledge-production --remote \
  --command "SELECT examiner_id, question_id, observation_count FROM examiner_questions ORDER BY observation_count DESC LIMIT 5"
# observation_count must be > 0
```

### 9. Custom domain

Only if the owner supplies a Cloudflare-managed hostname **and** explicitly
authorizes the change. Otherwise stop at the `workers.dev` URL.

---

## Rollback

The ChatGPT-hosted site is unchanged throughout and is the rollback target.

To withdraw the Worker deployment:

```bash
npx wrangler rollback --name osce-production          # previous version
npx wrangler delete --name osce-production            # remove entirely
```

Migration `0005` does **not** need rolling back. It only adds a nullable column
and two indexes, and recomputes columns that were previously always zero — the
previous code ignores all of it.

---

## Node version — read before running CI

`pdfjs-dist@6.2.108` calls `Promise.try`, which requires **Node 23 or newer**
(V8 13.0). The package declares `>=22.13.0 || >=24`, and the app previously
declared `>=22.13.0`, so a build environment was free to select Node 22 — where
both PDF tests fail with `TypeError: Promise.try is not a function` and PDF
upload breaks at runtime.

`package.json` now declares `>=24.0.0`. Pin CI and any local toolchain to Node 24.

This is not a regression introduced by the current change: the two PDF tests
fail identically on Node 22 before any of it. They could not be run in the
preparing session because only Node 22 was available there, so **run them on
Node 24 before deploying** — they are the only two checks not verified.

The Workers runtime is unaffected: `compatibility_date` is `2026-08-28` with
`nodejs_compat`, and workerd's V8 provides `Promise.try`.

---

## What changed in this revision

| ID | Change | Migration |
|---|---|---|
| F1 | `lib/evaluation.ts` now matches key points on whole tokens through a controlled medical vocabulary, with negation, hedging, abbreviation, Arabic/English and typo handling. Public API, input shape and stored format all unchanged. | none |
| F2 | Answers insert with `ON CONFLICT DO NOTHING` and return `409 ALREADY_ANSWERED`. Previously `INSERT OR REPLACE` allowed unlimited resubmission after seeing the score. | none |
| F3 | Occurrences carry a deterministic fingerprint with a unique (non-partial) index; observation counts are recomputed from approved occurrences at publish time. They were previously never written at all. | `0005`, applied |
| F5 | Admin token compared in constant time. | none |
| F10 | Evaluator confidence stored as a number. Fresh databases declare the column `REAL`; the existing production database keeps `TEXT` affinity, so aggregate with `CAST(confidence AS REAL)`. | none |
| F12 | Self-score derives the score from the declared correctness server-side instead of trusting a client-supplied number. | none |
| — | `engines.node` corrected to `>=24.0.0`. | none |

13 evaluator regression tests and 5 migration tests cover every behaviour
above. The migration tests apply the real migration files to an in-memory
database and run the application's own statements against them, which is what
caught the partial-index defect. The original evaluation contract test is
unchanged and still passes.
