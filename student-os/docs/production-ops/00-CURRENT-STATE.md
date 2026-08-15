# 00 — Current State

Read-only audit of `student-os` at `origin/main` (commit `aadae41`, the merge of PR #13). Every claim below is evidence-based — file and line, not inference — except where explicitly marked `INFERENCE` or `NEEDS LIVE VERIFICATION`. This document is the factual baseline every other document in `docs/production-ops/` builds on; where a later document repeats a fact from here, treat this one as the citation of record.

This repository (`student-os`) is one project inside a larger git repository at `/home/user/ahmed-workspace`, which also holds three unrelated projects (`furniture-os`, `medmind`, a static site). That matters for two structural facts used throughout this audit: CI lives at the *outer* repo root, not inside `student-os/`, and `docs/production-ops/` (this directory) sits under `student-os/docs/`, matching where `docs/app-store/` already lives.

---

## Status vocabulary

Every capability claim in this document set carries one of these five labels. They exist to keep a recommendation from being read back later as a shipped feature — the single most common way an architecture document becomes a lie over time.

| Label | Means |
|---|---|
| `EXISTS_NOW` | Implemented, in the deployed path, verifiable by reading the cited file |
| `PARTIALLY_EXISTS` | Some of it is real; the cited gap is what is missing. Never round this up to `EXISTS_NOW` |
| `DOCUMENTED_ONLY` | A repository document describes it; **no code implements it**. Aspirational text, not capability |
| `RECOMMENDED` | This audit proposes it. Nothing in the repository does it today |
| `BLOCKED_BY_EXTERNAL_DEPENDENCY` | Cannot be done in-repo — needs a platform capability, a vendor account, or a live-environment action |

The distinctions that matter most in this set, stated once here so no later document blurs them:

- Health/readiness endpoints `EXISTS_NOW`; external uptime monitoring of them is `RECOMMENDED`.
- Structured logging `EXISTS_NOW`; APM and error tracking are `RECOMMENDED`.
- Admin server capability `PARTIALLY_EXISTS`; admin UI does not exist at all.
- Backup and restore scripts `EXISTS_NOW`; proof that a restore works is `RECOMMENDED` and has never been produced.
- A realtime WebSocket implementation `EXISTS_NOW` in the codebase; realtime delivery on the deployed host does **not** work at all (§1.6).

---

## 1. Production API

### 1.1 What actually runs in production

The API is **one Fastify application**, `apps/api/src/http/app.ts` (`buildApp()`), deployed two different ways depending on target:

- **Netlify Function (the live production path).** `netlify/api/handler.mts` wraps the same `buildApp()` and dispatches every request through `app.inject()` — Fastify's in-process dispatch, not a real socket (`handler.mts:28-32,295-303`). The function's own doc comment states the intent directly: "the deployed API is the same code, the same routes and the same authorization layer that `pnpm dev` and the test suite exercise" (`handler.mts:18-39`, citing ADR-0003). The function is packaged by `scripts/bundle-function.mjs` (esbuild, `external: []`, one file, no bare imports) rather than left to Netlify's own nft-based v2 packaging, which cannot resolve this API's bare imports (`zod`, `fastify`, `pg`, `@sos/contracts`, …) — `netlify.toml:21-28` documents why `node_bundler` is deliberately unset.
- **Long-running server (`apps/api/src/index.ts`).** A conventional `app.listen()` process with `SIGTERM`/`SIGINT` draining the pool before exit. A companion `apps/api/Dockerfile` exists (multi-stage, distroless-ish `node:22-slim`, non-root `USER node`, `HEALTHCHECK` on `/health/ready`). **There is no evidence this path is deployed anywhere** — no Kubernetes manifest, no `docker-compose.yml`, no container registry reference, and CI never builds or pushes the Dockerfile. Its real, confirmed use today is local development (`pnpm dev:api`) and as the server CI's `journey` job runs for the E2E/smoke suite (`ci.yml:257`, `node apps/api/dist/index.js`) — a CI-only usage, not a second production target.

**`docs/01-TECHNICAL-ARCHITECTURE.md` §10 ("Multi-stage Dockerfile … GitHub Actions … Migrations run as a separate step before the app starts") describes the second path as if it were the deployment story, and does not mention Netlify at all.** That document is marked `Status: Approved for Phase 0` at its own top line — it is a Phase-0 planning document, never updated as the actual deployment moved to Netlify Functions sometime after. It is stale, not wrong-on-arrival: treat its §8–11 (environments, observability, deployment, scaling) as historical intent, not current fact. This audit supersedes it for production-operations purposes.

### 1.2 Request path

`netlify.toml` routes `/v1/*`, `/health`, `/health/*` to the function; everything else (the Expo web export at `apps/mobile/dist`) is served as static files from Netlify's own CDN — an ordinary page load never triggers a cold start. `EXPO_PUBLIC_API_URL=same-origin` is baked into the client build (`scripts/netlify-build.sh:27`), so client and API share one origin: no CORS, and no way for the two halves to be deployed pointing at different hosts.

### 1.3 Boot sequence (per Netlify function instance)

`boot()` in `handler.mts:128-160`, memoized per warm instance so concurrent requests share one boot (`handler.mts:191-201`):

1. Resolve `DATABASE_URL` from `@netlify/database`'s `getConnectionString()` if not already set (`handler.mts:129-134`) — ties each deploy/branch to its own database branch (Netlify DB is Neon-backed; `package.json` depends on `@netlify/database@^1.0.4`).
2. Register the Netlify Blobs storage driver via `setStorage()` (`handler.mts:87-115,136-137`).
3. Locate the migrations directory and run `migrate()` (`handler.mts:144`) — **migrations run at cold-start, in-process**, guarded by a Postgres advisory lock (`migrate.ts:46-47,92-138`, key `8_675_309`) so concurrent cold starts serialize rather than race; each migration commits independently, so a cold start cut short by the invocation timeout resumes rather than restarting.
4. Seed academic hierarchy data (idempotent upsert) and, if `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` are set, bootstrap an administrator (`handler.mts:174-189`). **These two env vars are read directly via `process.env`, outside `config.ts`'s validated schema.**

`scripts/netlify-build.sh` *also* attempts migrations at build time (lines 76-95), reading `NETLIFY_DB_URL` → `NETLIFY_DATABASE_URL_UNPOOLED` → `NETLIFY_DATABASE_URL` in that order and using a throwaway `JWT_SECRET` scoped to the build step only. If no DB URL is available at build time, migration is deferred to the first cold-start boot. A migration failure at build time fails the deploy loudly (`set -euo pipefail`); a migration failure at boot time surfaces as a `503` to every request against that instance until it's fixed.

### 1.4 Health / readiness

`apps/api/src/modules/health/health.routes.ts` — an explicit liveness/readiness split, stated in its own header comment:

- **`GET /health`** — liveness only, does not touch the database (`health.routes.ts:6-13,15-25`). Returns `{status:'ok', uptimeSeconds}`.
- **`GET /health/ready`** — `Promise.all([isHealthy(), isSchemaCurrent()])` (`health.routes.ts:27-46`). `isHealthy()` (`db.ts:120-127`) runs `SELECT 1`; `isSchemaCurrent()` (`migrate.ts:187-197`) compares the count of `.sql` files on disk against `schema_migrations` rows. `200 {status:'ready'}` only if both are true, else `503 {status:'not_ready'}`. This is a genuine schema-currency check, not a bare TCP ping.

### 1.5 Horizontal scaling — what's actually stateless

The Netlify path is stateless *per request* by design (auth, durable state, rate-limit intent all live in Postgres/Blobs), but the implementation carries real per-process state:

| State | Location | Scope | Documented? |
|---|---|---|---|
| Realtime connection registry | `realtime.ts:48`, `const connections = new Map<string, Set<Connection>>()` | one process | **Yes** — the module's own doc comment: "One process, one map... When a second process is needed, this file grows a Postgres `LISTEN/NOTIFY` bridge behind the same `publish` signature" (`realtime.ts:3-33`); moot on Netlify anyway since WebSockets don't work there at all (§1.6) |
| Typing indicators | `realtime.routes.ts:39` | one process | Same as above; also self-expiring (5s TTL) |
| Rate-limit counters | `@fastify/rate-limit`, registered `app.ts:98-105`, no `store:` option configured | one process (in-memory LRU, the plugin default) | **No** — `INFERENCE`: no comment anywhere acknowledges this. Under multiple concurrently-warm function instances, `RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_MAX` become a per-instance ceiling, not a global one. |
| DB connection pool | `db.ts:32-53`, module-level `pg.Pool`, `max: DATABASE_POOL_MAX` (default 10) | one process | Implicit in the architecture; not flagged as a scaling risk anywhere in-repo. See §2.4. |

### 1.6 The one documented, deliberate degradation: realtime WebSockets

`handler.mts:34-39`, verbatim: *"WHAT DOES NOT WORK HERE, and is not made to look like it does: the realtime WebSocket at `/v1/realtime`. A function is invoked per request and cannot hold a connection open, so the upgrade fails, the client's backoff takes over and messaging falls back to its HTTP path — messages send and load, they just do not arrive by themselves."* Also documented in `docs/app-store/06-APP-REVIEW-NOTES.md:32` and `docs/app-store/00-READINESS-AUDIT.md:90`. See `03-MESSAGING.md` for the full architecture and the actual client-side consequence (which is more precisely "load-on-demand" than "polling" — there is no polling loop anywhere in the mobile client).

### 1.7 Deployment and rollback

**CI** (`/home/user/ahmed-workspace/.github/workflows/ci.yml` — at the **outer repo root**, not inside `student-os/`; GitHub Actions only discovers workflows there, and this file's own header explains a prior version nested inside `student-os/` silently never ran for "Phases 0 through 5"). Two jobs, gated by `paths: ['student-os/**', '.github/workflows/ci.yml']` so unrelated sibling projects don't trigger it:

- **`verify`** — install → build shared packages → `pnpm typecheck` (includes `netlify/tsconfig.json`) → `pnpm lint` → `pnpm test:unit` → `pnpm test:integration` → migrations-from-empty assertion (`ls apps/api/migrations/*.sql | wc -l` must equal `SELECT count(*) FROM schema_migrations`) → API build → client bundle build (with a deliberately fake `EXPO_PUBLIC_API_URL` to prove `build:web` refuses an unset one) → **the deployment-contract gate**: `scripts/bundle-function.mjs` + `scripts/verify-function-package.mjs`, which packages with Netlify's *actual* bundler, unpacks it, imports the handler from a directory with no access to the repo's `node_modules`, drives live HTTP requests against it (readiness, rejected login, unknown route), and asserts a failed boot leaks no stack trace, path, connection string, or secret. This gate exists because of a real production incident: a bare-import regression (`Cannot find package 'zod'`) reached production while every earlier check was green.
- **`journey`** — builds, seeds, starts the real long-running server, serves the web bundle, and runs the API smoke suite plus four Playwright E2E journeys (first-run Arabic, two-browser messaging with a dropped connection, classroom, RTL/layout audit across locale × viewport), uploading screenshots as artifacts on any outcome.

**No dependency-vulnerability or secret-scanning step exists in CI** — no `pnpm audit`, no Dependabot config, no Snyk. `scripts/appstore-check.mjs`'s demo-credential grep is scoped only to `apps/mobile/app`/`apps/mobile/src` (the mobile bundle), not `apps/api`. See `08-SECURITY.md`.

**Deploy.** No explicit deploy job exists in `ci.yml` — `netlify.toml`'s `[build] command = "bash scripts/netlify-build.sh"` strongly implies Netlify's own git integration auto-builds and auto-deploys on push to whichever branch is connected (`INFERENCE` — site-linking configuration lives in Netlify's dashboard, not this repo). CI (the gate above) and deploy (Netlify's build) are two separate pipelines that happen to run the same build script.

**Rollback.** None is implemented in this repository:
- No down-migrations exist. `migrate.ts` is forward-only and checksummed — an already-applied migration whose file contents changed throws a hard error rather than allowing a silent rewrite (`migrate.ts:106-113`: *"Applied migrations are immutable — add a new migration instead of editing this one."*). Recovery from a bad migration is a new forward migration, or a full database restore (`ops/`).
- No rollback script for the deployed artifact exists in-repo; Netlify's own deploy-history/instant-rollback is the implied mechanism (`INFERENCE` — a platform capability, not something this repo codifies).
- `ops/restore-drill.sh` exists and is well-designed (see `06-BACKUP-RESTORE.md`) but `git log --oneline -- ops/` shows exactly one commit — the scripts were written and asserted correct in isolation; **there is no evidence in git history that the drill has ever actually been run against a real database.**

### 1.8 Environment / secrets

Full schema: `apps/api/src/platform/config.ts:12-85` (Zod, validated once at boot; a missing/malformed variable is a startup crash, never a silent default).

| Variable | Required | Default | Note |
|---|---|---|---|
| `DATABASE_URL` | **yes, secret** | — | `min(1)` only — no SSL/host validation (§8, `08-SECURITY.md`) |
| `JWT_SECRET` | **yes, secret** | — | `min(32)`, explicitly no default: *"a hardcoded fallback secret is the single most common way a deployment ships with forgeable tokens"* |
| `MEDIA_URL_SECRET` | **yes in production, secret** | falls back to `JWT_SECRET` outside prod | boot throws if `NODE_ENV=production` and unset |
| `AI_API_KEY` | no, secret | — | server-side only, never exposed to clients |
| `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` | no, secret | — | unused — `S3StorageDriver` is unimplemented (§3) |
| `STORAGE_DRIVER` | no | `local` | **`local` forbidden in production** — hard throw at boot |
| `SUPPORT_URL`/`PRIVACY_POLICY_URL`/`TERMS_URL`/`SUPPORT_EMAIL` | no at boot, yes at App Store release gate | — | enforced by `pnpm appstore:check`, not by the API |
| everything else (`PORT`, `RATE_LIMIT_MAX`, `ACCESS_TOKEN_TTL_SECONDS`, …) | no | sensible defaults | non-secret |

**Read outside the validated schema** (`process.env` directly, no validation): `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` (`handler.mts:175-177`), `NETLIFY_DB_URL`/`NETLIFY_DATABASE_URL_UNPOOLED`/`NETLIFY_DATABASE_URL` (build-time only), `LAMBDA_TASK_ROOT` (fallback migrations-dir candidate).

**Supply mechanism.** No `NETLIFY.md`/`DEPLOY.md`/runbook exists documenting how secrets are actually entered into Netlify's environment configuration, and no in-repo mention of Netlify's Sensitive Variable Policy. `scripts/netlify-build.sh` uses a clearly-labeled throwaway `JWT_SECRET` for build-time migrate/seed steps specifically to keep the real signing key scoped to the function that needs it. The strong implication is that real secrets live only in Netlify's own env-var UI — `NEEDS LIVE VERIFICATION`.

**No hardcoded/logged secrets found.** Pino redaction (`logger.ts:12-26`) scrubs `password`, `passwordHash`, `refreshToken`, `accessToken`, `token_hash`, `AI_API_KEY`, `JWT_SECRET`, and auth headers/cookies from every log line. The boot-failure envelope (`handler.mts:217-264`) is hardened against exactly the incident that motivated it (a leaked `/var/task` path, stack frame, and connection string) and this is independently regression-tested by `verify-function-package.mjs`'s leak probe, which boots the packaged function with a fake password (`hunter2`) and asserts it never appears in the public response. Full detail in `08-SECURITY.md`.

---

## 2. PostgreSQL

### 2.1 Provider

Netlify DB (`package.json`: `"@netlify/database": "^1.0.4"`), which is Neon-backed Postgres — confirmed by `handler.mts:129-134`'s branch-per-deploy-preview connection resolution and `netlify-build.sh`'s pooled/unpooled connection-string naming, both hallmarks of Neon. **Neon natively supports point-in-time recovery and database branching, but nothing in this repository configures, documents, or relies on that capability** — no ADR, no ops doc, no `NETLIFY*.md` mentions PITR or branching-as-backup-strategy. Whether it's separately relied upon operationally is unstated and unknown from the code. See `06-BACKUP-RESTORE.md`.

### 2.2 Schema — 16 migrations, `apps/api/migrations/0001`–`0016`, 2,610 lines total

Most tables are bounded (reference data, one-row-per-entity, or composite-PK capped per (user, entity) pairs — e.g., `learning_progress` PK `(user_id, topic_id)`, `lecture_progress` PK `(user_id, lecture_id)`). The schema's authors have already reasoned carefully about unbounded growth in two places, worth quoting directly because they show the pattern to imitate elsewhere:

- **`content_views`** (`0007_social_and_content.sql:41-44`) is one row per `(user_id, content_id)` with a `view_count` counter, not append-only: *"an append-only impression log would be the single fastest-growing table in the product for no V1 benefit."*
- **`message_receipts`** (`0004_messaging.sql:118-123`) was originally one row per message per recipient — explicitly identified and abandoned in `0010_messaging_delivery.sql:1-21`: *"a 200-member group chat writes 200 rows per message... the fastest-growing object in the product."* Replaced by a single `last_delivered_seq` counter column on `conversation_members`. The old table is left in place, unused.

**High-growth tables that received no equivalent redesign:**

| Table | Grows with | Indexes | Retention/partitioning |
|---|---|---|---|
| `messages` | every chat message | `(conversation_id, client_message_id)` unique, `(conversation_id, seq)` unique, `(conversation_id, seq DESC) WHERE deleted_at IS NULL` | none |
| `learning_events` | every learning action, including several *non-meaningful* kinds (`lecture_opened`, `resource_opened`, `quiz_started`, …) | `(user_id, occurred_at DESC)`, `(kind, occurred_at DESC)`, `(topic_id, occurred_at DESC)` | **none** |
| `analytics_events` | every product-analytics event | `(name, occurred_at DESC)`, `(user_id, occurred_at DESC)` | **none** |
| `audit_log` | every privileged/admin mutation | `(actor_id, created_at)`, `(target_kind, target_id, created_at)` | **none** |
| `notifications` | every event × its fan-out to recipients (multiplies row count per source event — plausibly the fastest-growing of this set) | `(user_id, created_at DESC) WHERE read_at IS NULL`, `(user_id, created_at DESC)` | **none** |
| `domain_events` | one row per domain mutation across messaging/content/moderation/social — called "the hottest write path in the product" in its own migration comment (`0009_phase3_closure.sql:134-140`) | `(occurred_at, id) WHERE processed_at IS NULL` (partial), `(target_type, target_id, occurred_at DESC)`, `(subject_id, kind, occurred_at DESC)` | none, but the partial index means drained history is cheap to skip |

None of `learning_events`, `analytics_events`, `audit_log`, or `notifications` has partitioning, a TTL, or an archival job defined anywhere in the 16 migrations. These are the tables that will dominate autovacuum load and backup size as usage grows — see `09-SCALE-PLAN.md`.

### 2.3 Messaging schema, specifically

Covered in full in `03-MESSAGING.md`. Summary: `conversations.last_seq` is a monotonic per-conversation counter incremented under a row lock (`FOR UPDATE`) at message-insert time; `conversation_members.last_read_seq`/`last_delivered_seq` are the sole source of truth for read/unread/delivery state (O(1) storage per membership, not per message); idempotency is `(conversation_id, client_message_id)`; ordering/gap-replay is `(conversation_id, seq)`.

### 2.4 Connection pooling

`db.ts:32-53` — `pg.Pool`, `max: DATABASE_POOL_MAX` (default 10, config-bounded 1–100), `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`. **Module-level singleton, one pool per process.** No pgbouncer or equivalent is referenced anywhere in this repository. `netlify-build.sh:73-75` prefers the *unpooled* Neon connection string for migrations specifically because "a connection pooler in front of DDL is a known source of confusing failures" — implying the *pooled* variant (Neon's own PgBouncer-style pooler, which Netlify DB fronts by default) is used for the runtime request path, though this is not explicit in `db.ts` itself and no pooler-aware setting (e.g., disabling prepared statements for PgBouncer transaction mode) is configured there.

**The exhaustion risk**: each concurrently-warm Netlify function instance owns an independent pool of up to 10 connections, uncoordinated across instances. No `statement_timeout`/`query_timeout` is configured anywhere, so a long-held transaction (e.g. the message-insert `SELECT ... FOR UPDATE` lock under a burst of concurrent senders in one hot conversation) can hold a pooled connection for its full duration. Under a genuine traffic spike with many concurrently-warm instances, this is a credible path to exhausting Neon's server-side connection ceiling. Quantified further in `09-SCALE-PLAN.md`.

### 2.5 Migration runner

Already described in §1.3. Three properties, all explicitly designed and stated in `migrate.ts`'s header: advisory lock (safe under concurrent cold starts), checksum verification (an applied migration whose contents changed is a hard error, not a silent rewrite), and per-migration transactionality (a failure rolls back only that file).

### 2.6 Backups

`ops/backup.sh`, `ops/restore.sh`, `ops/restore-drill.sh`, `ops/README.md` — all committed in one commit (`0cc2d18`, 2026-08-14). Full detail and the exact stated gaps are in `06-BACKUP-RESTORE.md`. Headline: the scripts are well-designed (checksum-verified, single-transaction restore, a drill that proves row-count and constraint parity after a real backup→restore round trip) but **the drill has never actually been run against a real database** per git history — it exists as unexercised, asserted-correct code, not a proven capability. The README states its own gaps plainly: no off-host copy, no schedule (RPO is "whenever someone last ran it"), and no coverage of object-storage bytes (only the database rows that point at them).

---

## 3. Media / Object Storage

### 3.1 Driver

`apps/api/src/platform/storage.ts` — a `StorageDriver` interface (`put`/`get`/`delete`) with two built-in implementations: `LocalStorageDriver` (disk, dev/test only, path-traversal-guarded) and **`S3StorageDriver`, which is unimplemented — its constructor unconditionally throws** (`storage.ts:73-77`). Production uses `STORAGE_DRIVER=external`, registered at boot by the Netlify adapter (`handler.mts:87-115`) to a **Netlify Blobs** driver (`getStore({name:'sos-uploads', consistency:'strong'})`). `STORAGE_DRIVER=external` with nothing registered throws rather than silently falling back to disk (`storage.ts:98-101`).

### 3.2 Upload path — images only

`sniffImage` (`image-meta.ts`) accepts exactly four formats by magic bytes — PNG, JPEG, GIF, WebP — ignoring the client's declared `Content-Type` entirely. Every accepted image is sanitized (`image-sanitize.ts`, strips EXIF/GPS/XMP, preserves JPEG orientation) before storage. Upload is **proxied through the Fastify function** via `@fastify/multipart` — every byte passes through the function's memory before reaching Blobs; there is no presigned-PUT / direct-to-bucket path. Cap: 8 MiB (`MAX_IMAGE_BYTES`, `packages/contracts/src/social/files.contract.ts:18`), enforced at both the multipart-plugin level and re-checked in the service.

**No other file type has a byte-upload path anywhere in this API.** `reel_details` (video) is schema-only — its `processing_status` state machine exists in migration `0003` but there is no reels module, service, or route under `apps/api/src/modules`. Classroom `materials` (`0005_learning.sql`, wired up in `0012_classrooms.sql`) accept either `fileId` (which can only reference an already-uploaded image, per the four-format sniff) or `externalUrl` — so **a PDF or PowerPoint lecture material can only be attached as an off-platform link, never as uploaded bytes.** The demo seed itself demonstrates this: it attaches a PDF via `externalUrl`, with a comment noting materials "take different paths" (`seed-demo.ts:742-747`).

### 3.3 Signed URLs — API-proxied reads, not CDN

`apps/api/src/modules/files/signed-url.ts` — HMAC-SHA256 over `fileId:expiresAtSeconds`, keyed by `mediaUrlSecret`, default 900s TTL, `timingSafeEqual` comparison, boolean-only verification result (no oracle distinguishing "expired" from "bad signature"). The signed URL is **relative and same-origin** (`/v1/files/:fileId/raw?exp=...&sig=...`), not a direct blob/CDN URL.

**`GET /files/:fileId/raw` reads bytes through the function and re-streams them** (`files.service.ts:118-127`, `getStorage().get(...)` then `reply.send(file.body)`) — no redirect to a blob URL exists anywhere in this route. The response is explicitly `Cache-Control: private, max-age=300` (`files.routes.ts:83-85`), which forbids any shared cache (CDN, edge, proxy) from storing it — only the requesting browser may cache, for 5 minutes. **Every media view today costs one function invocation plus one Netlify Blobs round trip; nothing bypasses the function for a repeat view of the same image.** `netlify.toml` has no `[[headers]]` cache block and no CDN configuration for the API path — only the static SPA shell is served from Netlify's platform CDN. Full implication in `04-MEDIA-CDN.md`.

### 3.4 Quotas, retention, orphan cleanup

- **No per-user storage quota exists anywhere** — only the global 8 MiB per-file cap.
- **Account deletion does delete storage objects**, correctly ordered (keys captured before the cascading `DELETE FROM users` removes the `files` rows that reference them), with failures recorded into `account_deletions.orphaned_object_keys` (`0015_moderation_and_deletion.sql`).
- **Nothing ever reads that column back.** A repo-wide grep finds only the write path.
- **`listOrphanedFiles`** (`files.repository.ts:227-245`, "uploaded but never attached to a post") exists as a query with zero callers anywhere in the codebase — no route, no script, no scheduled job. This is a real, present operational gap: unattached uploads and post-deletion-failure blobs accumulate in Netlify Blobs indefinitely with no automated or documented manual sweep.
- Backups explicitly exclude blob bytes (`ops/README.md`, quoted in §2.6 above and in full in `06-BACKUP-RESTORE.md`).

---

## 4. Messaging

Full architecture and citations in `03-MESSAGING.md`. Headline facts for this baseline:

- **Every write is HTTP, never the socket** — ADR-0011 ("The realtime socket notifies; the database decides"), accepted Phase 4. The socket carries only `subscribe`/`unsubscribe`/`typing`/`resync`; there is deliberately no `message.send` frame, specifically to prevent the failure mode where a client believes a message sent that the database never committed.
- **Realtime does not function at all on the deployed Netlify host** (§1.6). The mobile client's `RealtimeProvider` retries the WebSocket connection forever with exponential backoff and never succeeds; there is **no periodic poll** anywhere in the client to compensate, so new incoming messages surface only when a screen is reopened/refocused — closer to "load-on-demand" than the "polling" the App Store review notes describe it as.
- **Read/unread/delivery state is per-account, server-side**, not per-device: `conversation_members.last_read_seq`/`last_delivered_seq`, keyed by `(conversation_id, user_id)` — a phone and a laptop on the same account correctly share one read cursor.
- **Idempotency and ordering are both enforced by unique indexes** on `messages`, not application logic alone: `(conversation_id, client_message_id)` for retried sends, `(conversation_id, seq)` for gapless ordering.
- **Every message send in a given conversation is serialized by a `SELECT ... FOR UPDATE` row lock on `conversations`** — correct for gapless `seq` assignment, but a genuine contention point for a very active single conversation under concurrent senders.

---

## 5. Background jobs

**No queue or scheduled-job infrastructure exists anywhere in this repository.** Confirmed by exhaustive search: no `bull`/`bullmq`/`pg-boss`/`node-cron` dependency, no `setInterval` used for recurring work outside `node_modules`, no cron string anywhere, no scheduled Netlify Function. Everything the API does happens synchronously inside one HTTP request/response cycle of one function invocation.

Per-operation assessment (full detail in `01-TARGET-ARCHITECTURE.md` §5 and `10-IMPLEMENTATION-PLAN.md`):

| Operation | Today | Risk |
|---|---|---|
| Notifications | **Inert.** `push_tokens` table and cleanup-on-deletion exist; no code anywhere sends a push. `domain_events` (the outbox) is explicitly "Phase 8 adds the relay and delivery" per its own doc comment — nothing consumes it yet. | None today (nothing runs); becomes a queue requirement the moment sending is implemented, since `emit()` already happens inside the same transaction as the write it describes. |
| Media processing (`image-sanitize.ts`) | Synchronous, inline in the upload request. Pure length-prefixed segment copying, no pixel decode — cheap relative to real transcoding, proportional to the 8 MiB cap. | Low today; would need to move off the request path if real resize/transcode is ever added. |
| Email (password reset) | **No-op.** `platform/mailer.ts` logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` and returns; deliberately does not log the token as a stand-in for sending it. | None today; the moment a provider is wired in, sending should be async/retryable rather than inline in the request handler. |
| Orphaned-upload cleanup | Query exists (`listOrphanedFiles`), **zero callers**. | Present gap — unattached uploads accumulate with no sweep. |
| Account deletion | Synchronous, one HTTP request, one DB transaction, **no batching/pagination anywhere** in the deletion queries; post-commit storage-object deletes are a plain sequential `for` loop with no concurrency and no retry. | **Real, plausible timeout risk** for a large account (many years of posts/files, ownership of several groups/classrooms) against Netlify Functions' execution-time ceiling. |
| Moderation gate | Synchronous, inline, before the content-insert transaction. Pure regex/lexicon matching, no ML, no network call, effectively O(1) given the 8000-char message cap. | Not a risk — correctly kept synchronous. |
| Retries | **None server-side**, for anything. The only retry logic in the system is client-side (the mobile `Outbox`'s send-retry, and the WebSocket reconnect backoff — itself a client-only retry, not a server mechanism). `S3StorageDriver` isn't even implemented, so there's nothing to retry against on that path yet. | Storage-delete failures during account deletion are caught and recorded (not retried) into a column nothing reads back. |

---

## 6. Monitoring / Observability

**No external APM, error-tracking, or metrics tooling exists anywhere** — confirmed by searching every `package.json` in the monorepo and the mobile/API source for Sentry, Datadog, New Relic, Honeycomb, Logtail, Axiom, Grafana, Prometheus, OpenTelemetry: zero matches.

What does exist:
- **Structured JSON logs** (pino, `logger.ts`), with centrally-configured redaction (§1.8) and one access-log line per request carrying `method`, `route`, `status`, `durationMs`, `actorId`, and a correlation id (`requestId`, minted or echoed per request, attached to every child logger and every error envelope — `request-context.ts:21-51`). This is real, queryable raw material *if* something ships these logs to an aggregator — nothing in this repo does that shipping; it's `console`/stdout, captured by whatever the deploy platform does with function logs (Netlify's own function-log viewer, by default — `NEEDS LIVE VERIFICATION` for retention/searchability there).
- **Liveness/readiness** (§1.4) — sufficient for a platform health check, not a dashboard.
- **`docs/01-TECHNICAL-ARCHITECTURE.md` §9 claims "Reserved metric surfaces: AI latency/errors, realtime connection errors, DB pool saturation."** No such metrics are actually emitted anywhere in the current codebase — this is the same Phase-0-era aspirational language flagged in §1.1; treat it as a stated intent that was never built, not a capability that exists.
- **Zero mobile crash reporting.** No `ErrorBoundary` component, no `app/+error.tsx` or equivalent, no crash-reporting SDK (Sentry, Bugsnag, Crashlytics) anywhere in `apps/mobile`. An unhandled render error in production shows the platform's default red-screen/crash with no report reaching anyone.
- **No alerting of any kind** — no PagerDuty/Opsgenie integration, no threshold-based notification, nothing.

Full target-state definition in `05-MONITORING.md`.

---

## 7. Admin / Company Control Plane

Full detail and the capability table in `07-ADMIN-CONTROL-PLANE.md`. Headline: the admin module (`apps/api/src/modules/admin/`) is, by its own header comment, "Admin V0... Four endpoints, one subject: who is academically eligible to teach." `isPlatformAdmin` (`role==='admin' && status==='active'`, `packages/core/src/policy/actor.ts:112-114`) is a single, consistently-used definition across every admin-adjacent check in the codebase.

**`ADMIN_CAPABILITY_EXISTS` (server) vs. `ADMIN_UI_EXISTS` (mobile) diverge sharply.** Every admin capability that exists server-side — user search, verification grant/revoke, verification history, the moderation report queue, report resolution (including account suspend/ban as a side effect), and admin-initiated content deletion — has **zero client UI**. `apps/mobile/app/` and `apps/mobile/src/` contain no admin screen and no code path calling `/v1/admin/*` or `/v1/moderation/*` at all; the only callers of those routes anywhere under `apps/mobile` are two Node E2E test scripts that hit the API directly to set up fixtures, not app UI a human could use. A human operator's only path to any of this today is direct API calls or the `admin:bootstrap` CLI script.

Gaps within the server-side capability itself: the automated moderation gate's own decisions (`moderation_decisions`) are recorded but never read back by any route (an admin cannot see what the automated filter itself flagged); there is no admin view of a user's block list or of "all reports against user X"; there is no platform-wide view of classrooms or groups (only per-container roles exist); the audit log (`audit_log`) is written by exactly two call sites (verification-level changes, admin bootstrap) and read back by exactly one narrow route — moderation actions and admin content deletions are not written to it at all, landing instead in the separate `moderation_actions` table that nothing joins against `audit_log`.

---

## 8. Security

Full detail in `08-SECURITY.md`. Corrections to one research finding, reconciled here: **CI does exist** (§1.7) — an earlier pass of this audit, scoped only to `student-os/`, incorrectly reported no `.github/workflows` directory anywhere in the repository; it lives one level up, at the outer repo root, exactly as the CI file's own header explains was necessary for GitHub Actions to discover it at all. The corrected, narrower finding stands: CI is thorough (typecheck, lint, unit, integration, migration-from-empty, the deployment-contract gate, full E2E) but has **no dependency-vulnerability or general secret-scanning step** — only a narrow, mobile-bundle-scoped grep for three demo-credential patterns.

Confirmed-secure-by-design, with evidence: pino redaction; the hardened, regression-tested boot-failure envelope; `canAccessFile` as the single, consistently-applied policy gate for file access, called before any signed URL is minted; HMAC-SHA256 signed URLs with constant-time comparison and a boolean-only (non-oracle) verification result; UUID (not sequential) storage keys, sharded by owner and date; path-traversal guarding on the local driver; a single, consistently-called `isPlatformAdmin` definition, gated at the service layer (a deliberate choice over a route-level hook, per the admin module's own comment, specifically to avoid "two places that decide who is an administrator [that] can disagree"); backup scripts that never persist or log the connection string, gitignored dump artifacts, and a restore script that refuses a non-scratch target without an explicit opt-in.

**Confirmed gaps, with evidence:** no production-side validation of `DATABASE_URL` (no SSL enforcement, no rejection of unexpected hosts) — contrast this with the equivalent guards that *do* exist for storage driver and media-URL secret; the admin authorization pattern is convention-based (every service function happens to call `assertMayAdminister` first) with no structural/lint enforcement that a future admin route couldn't skip it; no dependency-audit tooling. Items marked `NEEDS LIVE VERIFICATION` in `08-SECURITY.md`: whether Netlify's Sensitive Variable Policy is enabled on the live site; whether the Netlify Blobs store is genuinely private by default; actual live values of `AUTH_RATE_LIMIT_MAX`/`RATE_LIMIT_MAX` if overridden via Netlify env config; whether the live `DATABASE_URL` enforces SSL.

---

## 9. Scale — what the code already tells us

The schema's authors have twice already reasoned explicitly about growth and made a deliberate design change as a result (`content_views`, `message_receipts` — §2.2). That discipline was not applied to `learning_events`, `analytics_events`, `audit_log`, or `notifications`, all of which are unbounded, unpartitioned, and un-retained today. `docs/01-TECHNICAL-ARCHITECTURE.md` §11 sketches a scaling table (realtime hub → Postgres `LISTEN/NOTIFY` bridge; feed ranking → precomputed tables + worker; media processing → "queued job table" + workers) that is directionally sound but, per §5 above, describes infrastructure (a job queue) that does not exist today in any form — not even the "queued job table" it names. Full quantified scale plan in `09-SCALE-PLAN.md`.

---

## 10. `DOCUMENTATION_DRIFT` — stale in-repo documentation

Recorded, not repaired. This audit deliberately does not rewrite the affected documents: silently editing architecture history inside a production-operations PR would destroy the record of what was originally intended and when it stopped being true. Each row below is a follow-up, tracked in `10-IMPLEMENTATION-PLAN.md`.

| # | Stale document | What it says | Current live truth | Recommended follow-up |
|---|---|---|---|---|
| 1 | `docs/01-TECHNICAL-ARCHITECTURE.md` §10 | Deployment is a multi-stage Dockerfile built and pushed by GitHub Actions, with migrations run as a separate step before the app starts | The deployed API is a **Netlify Function** dispatching through `app.inject()` (§1.1). Migrations run **in-process at cold-start boot**, advisory-lock-guarded (§1.3), and also opportunistically at build time. The Dockerfile exists but is deployed nowhere | Update §10 to describe the Netlify path, and mark the Dockerfile as local-dev/CI-only — in its own PR, not this one |
| 2 | `docs/01-TECHNICAL-ARCHITECTURE.md` §9 | "Reserved metric surfaces: AI latency/errors, realtime connection errors, DB pool saturation" | `DOCUMENTED_ONLY`. **No metrics are emitted anywhere in the codebase** (§6). Zero APM, zero metrics tooling | Either implement the metrics or restate the section as intent. Do not leave it readable as capability |
| 3 | `docs/01-TECHNICAL-ARCHITECTURE.md` §11 | Scaling sketch naming a "queued job table" + workers for media processing | `DOCUMENTED_ONLY`. **No queue, no job table, no worker exists in any form** (§5) — not even the table it names | Fold into the background-jobs work in `01-TARGET-ARCHITECTURE.md` §5; update the doc once something real exists |
| 4 | `docs/01-TECHNICAL-ARCHITECTURE.md` header | `Status: Approved for Phase 0` | The document has not been updated as the deployment target changed | Add a pointer to `docs/production-ops/` as the current operations source of truth |

The whole of `docs/01-TECHNICAL-ARCHITECTURE.md` §8–11 (environments, observability, deployment, scaling) should be read as **Phase-0 historical intent, not current fact**. For production-operations purposes this document set supersedes it.

---

## Documents in this set

| File | Covers |
|---|---|
| `00-CURRENT-STATE.md` | this document |
| `01-TARGET-ARCHITECTURE.md` | production API hosting, scaling model, deploy/rollback, background-jobs decision |
| `02-DATA-STORAGE.md` | PostgreSQL — growth, indexes, pooling |
| `03-MESSAGING.md` | messaging persistence, realtime transport, offline delivery, multi-device sync |
| `04-MEDIA-CDN.md` | object storage, signed URLs, CDN, quotas, retention, orphan cleanup |
| `05-MONITORING.md` | uptime, latency, error rates, DB/WebSocket/storage/job health, mobile crashes, alerting |
| `06-BACKUP-RESTORE.md` | backup strategy, RPO/RTO, the restore drill and its actual (unproven) status |
| `07-ADMIN-CONTROL-PLANE.md` | Admin V0 audit and the minimum real console for a broad pilot |
| `08-SECURITY.md` | secrets, logging/PII, storage access, DB exposure, admin authz, backup access |
| `09-SCALE-PLAN.md` | 1k / 5k / 50k / 500k students — what changes and when |
| `10-IMPLEMENTATION-PLAN.md` | ranked P0/P1/P2 plan and the final readiness verdicts |
