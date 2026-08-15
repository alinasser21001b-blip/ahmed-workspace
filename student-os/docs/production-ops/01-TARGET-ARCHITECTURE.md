# 01 — Target Architecture

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), which is the citation of record for every fact restated here. Answers audit area **§1 Production API** and **§5 Background jobs**. Status labels (`EXISTS_NOW`, `PARTIALLY_EXISTS`, `DOCUMENTED_ONLY`, `RECOMMENDED`, `BLOCKED_BY_EXTERNAL_DEPENDENCY`) are defined in `00-CURRENT-STATE.md`.

## 1. The architecture decision, restated and kept

**Modular monolith. One Fastify application. PostgreSQL as structured truth, object storage for heavy binary content, device as cache/offline.** This is `docs/adr/0001-modular-monolith.md`, already accepted, and this audit found no evidence to overturn it.

No microservice extraction is recommended at any scale tier this audit has evidence for (`09-SCALE-PLAN.md`). Every change below is an operational change *within* the monolith — a hosting decision, a job runner, a config value — never a decomposition of it.

## 2. Current shape (`EXISTS_NOW`)

Per `00-CURRENT-STATE.md` §1:

- **Deployed path**: Netlify Function. `netlify/api/handler.mts` wraps the same `buildApp()` used by `pnpm dev` and the test suite, dispatching every request through `app.inject()` — Fastify's in-process dispatch, no listening socket. Packaged by a hand-written esbuild bundler (`scripts/bundle-function.mjs`) because Netlify's own nft-based packaging cannot resolve this API's bare imports.
- **Built but deployed nowhere**: `apps/api/src/index.ts` + `apps/api/Dockerfile` — a conventional `app.listen()` server with signal-draining and a `HEALTHCHECK`. Its only confirmed uses are `pnpm dev:api` and the CI `journey` job. No Kubernetes manifest, no compose file, no registry reference exists.
- **Boot per cold start**: resolve `DATABASE_URL` → register the Netlify Blobs driver → run migrations in-process under a Postgres advisory lock → seed academic data → optionally bootstrap an admin. Memoized per warm instance.
- **Health** (`EXISTS_NOW`): `GET /health` is liveness and does not touch the database; `GET /health/ready` runs `SELECT 1` **and** a genuine schema-currency check (migration files on disk vs. `schema_migrations` rows), returning `503` if either fails.

## 3. Hosting decision: stay on Netlify Functions

**Recommendation: keep the Netlify Function as the production hosting model. Do not deploy the Dockerfile path as a second production target.**

1. **No measured ceiling exists.** Nothing in this audit found request volume, latency data, or a cold-start complaint justifying a second deploy target with its own health checks, scaling policy, secrets wiring, and patch surface.
2. **The Docker path is a maintained escape hatch, not dead weight.** CI exercises it every run, so the migration cost — if a trigger appears — is low: same app, same routes, same modules.
3. **Serverless removes an operational category this team does not yet staff**: no host to patch, no capacity to pre-provision.

**One exception is a genuine open decision, not a deferral — see §4.**

## 4. The realtime problem: a hard platform constraint, not a future scaling concern

This is the sharpest architectural fact in the audit and the earlier drafts of this document understated it.

**`BLOCKED_BY_EXTERNAL_DEPENDENCY`: the realtime WebSocket at `/v1/realtime` does not work on the deployed Netlify host at all** — not "degrades under concurrency," not "will need attention at scale." A function is invoked per request and cannot hold a connection open, so the upgrade fails outright. `handler.mts:34-39` states this in the code itself, and `docs/app-store/06-APP-REVIEW-NOTES.md` and `docs/app-store/00-READINESS-AUDIT.md` both record it.

The consequence, stated precisely (see `03-MESSAGING.md`): the mobile client retries the connection forever with exponential backoff and never succeeds. **There is no polling loop anywhere in the client to compensate.** New incoming messages surface only when a screen is reopened or refocused — accurately described as *load-on-demand*, not as the "polling" the App Store review notes call it.

Because ADR-0011 makes every write an HTTP write and the socket purely a notification, **this is a latency and product-quality problem, not data loss** — nothing is ever lost, it just does not arrive by itself. That property is why the current state is survivable at all.

Three options, and this audit deliberately does not pick one, because the choice is a product call about whether "messages do not arrive until you reopen the screen" is acceptable for the pilot audience:

| Option | What it costs | Monolith preserved? |
|---|---|---|
| **A. Accept it for the pilot** | Zero engineering. Requires stating the degradation honestly in product/UX terms and in pilot comms rather than leaving it as an unflagged surprise | Yes |
| **B. Deploy the existing long-running server as the API host** | Activates a path already built and CI-exercised. Adds host patching, capacity, and deploy operations. Realtime then works as designed, and the in-process registry is correct again for a single process | **Yes** — same application, same modules, different host. This is not microservices |
| **C. Front realtime with a managed relay/pub-sub** | New vendor dependency; the Fastify app publishes to it instead of to an in-process map | Yes |

**In-process state, for completeness.** The realtime registry (`realtime.ts:48`) and typing indicators are per-process — but on the deployed host this is *moot*, since no sockets are ever held there. The registry's own doc comment already names its successor ("a Postgres `LISTEN/NOTIFY` bridge behind the same `publish` signature"), so the extraction path is designed but unexercised.

**The rate limiter is the one in-process state problem that is live today.** `@fastify/rate-limit` is registered at `app.ts:98-105` with **no `store:` option**, so it uses the plugin's default in-memory LRU. Per-instance, uncoordinated. Under multiple concurrently-warm instances, `RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_MAX` are a per-instance ceiling, not a global one — an abuse surface on the auth endpoints specifically. `INFERENCE`: no comment anywhere in the repository acknowledges this, unlike the realtime registry, whose limitation is documented. Fix is a shared store, and it is the *first* of the in-memory issues worth addressing because it is the only one with a security dimension.

## 5. Background jobs: introduce a narrow, Postgres-backed queue

**`00-CURRENT-STATE.md` §5: no queue or scheduled-job infrastructure exists anywhere.** No `bull`/`bullmq`/`pg-boss`/`node-cron`, no cron string, no scheduled Netlify Function, no recurring `setInterval`. Every operation happens synchronously inside one HTTP request/response cycle. `docs/01-TECHNICAL-ARCHITECTURE.md` §11 names a "queued job table" — that is `DOCUMENTED_ONLY`; the table does not exist.

**What actually needs a queue, ranked by whether the risk is present today:**

| Operation | Status today | Risk |
|---|---|---|
| **Account deletion** | Synchronous, one request, one transaction, **no batching or pagination anywhere** in the deletion queries; post-commit storage deletes are a sequential `for` loop with no concurrency and no retry | **Real and present.** A large account (years of posts and files, ownership of several groups/classrooms) is a plausible timeout against the Netlify Functions execution ceiling. This is a correctness bug that can fire on day one for a single user — it is not scale-triggered |
| **Orphaned-upload cleanup** | `listOrphanedFiles` exists in `files.repository.ts:227-245` with **zero callers** — verified repository-wide. No route, no script, no job | **Present gap.** Unattached uploads accumulate in Blobs indefinitely with no sweep |
| **Notifications** | **Inert.** `push_tokens` exists; **no code anywhere sends a push.** `domain_events` is the outbox and its own comment defers the relay to a later phase — nothing consumes it | None today, because nothing runs. Becomes a hard queue requirement the moment sending is implemented, since `emit()` already runs inside the same transaction as the write it describes |
| **Email** | **No-op.** `platform/mailer.ts` logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` and returns — and deliberately does not log the token as a stand-in for sending it | None today. Must be async/retryable the moment a provider is wired in |
| **Media processing** | Synchronous. `image-sanitize.ts` is length-prefixed segment copying, no pixel decode — cheap, bounded by the 8 MiB cap | Low. Would need to move off the request path only if real resize/transcode is added |
| **Moderation gate** | Synchronous, inline, pre-insert. Regex/lexicon only, no ML, no network call, effectively O(1) under the 8000-char cap | **None — correctly synchronous.** Do not move this |
| **Retries** | **None server-side, for anything.** The only retry logic in the system is client-side | Storage-delete failures during account deletion are caught and written to `account_deletions.orphaned_object_keys` — **a column nothing ever reads back** |

**Recommendation (`RECOMMENDED`): a durable job table in the existing Postgres database, drained by a scheduled Netlify Function.**

- **Why a table, not a broker**: Postgres is already the source of truth, already backed up, already the thing being operated. A broker is new infrastructure with no evidence yet demanding it. Shape: `id`, `type`, `payload`, `status`, `attempts`, `last_error`, `run_after`, `locked_at`. Include `status`/`attempts`/`last_error` from the first migration so the monitoring in `05-MONITORING.md` is a query away rather than a schema change away.
- **Why a scheduled Function, not a worker process**: same deploy, same secrets, same monolith — invoked on a timer instead of by HTTP. No new hosting model.
- **First consumers, in dependency order**: account-deletion cleanup → orphaned-upload sweep → notification fan-out (whenever sending is built) → email (whenever a provider is wired).
- **When this stops being enough**: if job volume or latency requirements outgrow poll-interval latency or the table contends, that is itself a concrete boundary — and the answer is a different queue backend, still inside the same monolith. See `09-SCALE-PLAN.md`.

## 6. Deploy and rollback

**Deploy** (`PARTIALLY_EXISTS`). CI (`.github/workflows/ci.yml`, at the outer repo root) is thorough: typecheck, lint, unit, integration, a migrations-from-empty assertion, a **deployment-contract gate** that packages the function with Netlify's real bundler, imports it from a directory with no access to the repo's `node_modules`, drives live HTTP against it, and asserts a failed boot leaks no stack trace, path, or connection string — a gate that exists because a bare-import regression once reached production. Plus a `journey` job running the real server and four Playwright E2E journeys.

But **no deploy job exists in CI**. `netlify.toml`'s build command implies Netlify's own git integration builds and deploys on push (`INFERENCE` — the site-linking configuration lives in Netlify's dashboard, not this repository). CI and deploy are two separate pipelines that happen to run the same build script.

**Rollback: none is implemented in this repository.** Two distinct facts, both important:

- **The artifact.** No rollback script exists in-repo. Netlify's deploy history / instant rollback is the implied mechanism — `INFERENCE`, a platform capability this repository does not codify. `RECOMMENDED`: write the runbook step (who rolls back, under what trigger, by what click) — documentation, not infrastructure.
- **The database.** **No down-migrations exist and none should be added.** `migrate.ts` is forward-only and checksummed: an applied migration whose file contents changed throws a hard error rather than silently rewriting (*"Applied migrations are immutable — add a new migration instead of editing this one."*). Recovery from a bad migration is therefore a **new forward migration, or a full database restore** — which makes the unproven restore path in `06-BACKUP-RESTORE.md` a direct dependency of rollback capability, not a separate concern.

`RECOMMENDED`: gate deploys on `/health/ready` with a post-deploy smoke check. The endpoint already exists and already checks schema currency; nothing currently calls it after a deploy, so a broken migration surfaces as `503`s to users rather than as a failed deploy.

## 7. Environment and secrets (`EXISTS_NOW`, one gap)

`apps/api/src/platform/config.ts:12-85` — Zod-validated once at boot; a missing or malformed variable is a startup crash, never a silent default. `JWT_SECRET` requires `min(32)` with explicitly no fallback (*"a hardcoded fallback secret is the single most common way a deployment ships with forgeable tokens"*). `MEDIA_URL_SECRET` is required in production. `STORAGE_DRIVER=local` throws in production. This is real fail-fast hygiene.

**Gaps**: `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` are read via raw `process.env`, outside the validated schema. `DATABASE_URL` is validated only as `min(1)` — no SSL enforcement, no host restriction — in pointed contrast to the guards that *do* exist for storage driver and media secret. Both are carried into `08-SECURITY.md`.

## 8. Summary of changes this document recommends

| Change | New infrastructure? | Priority |
|---|---|---|
| Post-deploy `/health/ready` smoke gate | No — pipeline step | P0 |
| Documented rollback runbook (artifact **and** the forward-migration/restore reality) | No — documentation | P0 |
| Postgres job table + scheduled Function worker | One table, one scheduled Function, same monolith | P0 |
| Move account-deletion cleanup onto the queue | Consumes the above — **hard dependency** | P0, after the queue |
| Shared-store rate limiter | New dependency (e.g. Redis) — the only in-memory issue with a security dimension | P1 |
| Decide the realtime option (A/B/C, §4) | Depends on the option chosen | P1 — a product decision, not a deferral |
| Orphaned-upload sweep job | Consumes the queue | P1 |
| Activate the long-running server path | Already built, not deployed | P2 / contingent on §4's decision |
