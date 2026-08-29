# Deployment runbook — osce-production

Everything that can be done without Cloudflare access has been done. This file
is the remaining sequence, written so it can be executed in one sitting once the
account blocker clears.

**Nothing in this repository has been deployed, and no Cloudflare resource has
been created, listed or modified.**

---

## Why deployment did not happen in the preparing session

| Blocker | Detail |
|---|---|
| No Cloudflare credentials | The session had no `CLOUDFLARE_API_TOKEN`, no `~/.wrangler` config, and the Cloudflare MCP connector was unauthorized. It was also non-interactive, so no OAuth flow could run. |
| Account verification | Per `NEXT_ENGINEER_BRIEF.md`, Cloudflare account email/security verification is outstanding. R2 remained disabled and its API returned code `10042`. |
| Owner had halted the cutover | The brief records an explicit stop. Resuming needs the owner's word, not an engineer's inference. |

The first two are hard blockers. No amount of preparation removes them.

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
| Tests | 20 of 22 passing on Node 22; the 2 failures are the PDF tests and are a Node-version artefact, not a regression — see the note below |
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

Never create a resource that may already exist. Read first:

```bash
npx wrangler d1 list
npx wrangler r2 bucket list
npx wrangler deployments list --name osce-production   # expect: not found
```

Expected state per the brief:

- `osce-knowledge-production` **exists**, id `d585d340-869f-4482-8871-91053f1eb8b0`,
  migrations `0001`–`0004` applied. Do not recreate it. Confirm the id matches
  `wrangler.jsonc`.
- `osce-documents-production` does **not** exist.
- Worker `osce-production` does **not** exist.

If anything differs from this, stop and reconcile against read-only listings
before making a change.

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
npm run db:migrate:status
npm run db:migrate:production
```

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
| F3 | Occurrences carry a deterministic fingerprint with a unique index; observation counts are recomputed from approved occurrences at publish time. They were previously never written at all. | `0005` |
| F5 | Admin token compared in constant time. | none |
| F10 | Evaluator confidence stored as a number. Fresh databases declare the column `REAL`; the existing production database keeps `TEXT` affinity, so aggregate with `CAST(confidence AS REAL)`. | none |
| F12 | Self-score derives the score from the declared correctness server-side instead of trusting a client-supplied number. | none |
| — | `engines.node` corrected to `>=24.0.0`. | none |

13 new evaluator regression tests cover every behaviour above. The original
evaluation contract test is unchanged and still passes.
