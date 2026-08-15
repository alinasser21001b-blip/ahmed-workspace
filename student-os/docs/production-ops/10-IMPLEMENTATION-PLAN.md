# 10 — Implementation Plan and Final Verdicts

> Synthesizes [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md) through [`09-SCALE-PLAN.md`](./09-SCALE-PLAN.md). Introduces no new findings — every item traces to the document that established it. Status labels are defined in `00-CURRENT-STATE.md`.

## 1. Final verdicts

```
PRODUCTION_ARCHITECTURE_DEFINED = YES
CURRENT_BACKEND_PILOT_CAPABLE   = NO
ADMIN_CONTROL_PLANE_READY       = NO
OBSERVABILITY_READY             = NO
BACKUP_RESTORE_PROVEN           = NO
```

**`PRODUCTION_ARCHITECTURE_DEFINED = YES`** — this set defines a concrete, evidence-based architecture at every layer the brief asked for, plus an explicit position at four scale tiers. *Defined* is not *implemented*; the other four flags say what remains. The architecture itself is decided: **modular monolith, Netlify Functions retained, PostgreSQL as structured truth, object storage for heavy binary content, device as cache/offline, a narrow Postgres-backed job queue, CDN where justified, and shared state introduced only at the tier a named mechanism requires it.** One genuine open decision is documented rather than hidden: the realtime option in `01-TARGET-ARCHITECTURE.md` §4, which is a product call, not a technical unknown.

**`CURRENT_BACKEND_PILOT_CAPABLE = NO`** — the foundation is genuinely strong: fail-fast config validation, PII-aware structured logging with correlation ids, a CI-tested boot-failure leak probe, sound signed-URL cryptography, a durable-first messaging design (ADR-0011), and service-layer admin authorization. Four specific unresolved risks make a *broad* pilot irresponsible today:

1. **Backups are unproven** — the restore drill has never been run (`06-BACKUP-RESTORE.md` §2). Compounded by the fact that migrations are forward-only with no down-migrations, so restore *is* the rollback path for a bad migration.
2. **Account deletion can time out** — synchronous, unbatched, single-transaction; a plausible failure for one large account today, at any scale (`01-TARGET-ARCHITECTURE.md` §5).
3. **No `statement_timeout`** on database connections, against uncoordinated per-instance pools and a real `SELECT ... FOR UPDATE` contention point on message sends (`02-DATA-STORAGE.md` §4).
4. **Nobody would be notified if it broke** — see `OBSERVABILITY_READY`.

None of these is a large engineering effort. That is exactly why the verdict is `NO` rather than a hedge: they are quickly fixable and they are not fixed.

**`ADMIN_CONTROL_PLANE_READY = NO`** — `ADMIN_UI_EXISTS` is false for **every** capability without exception; there is no admin screen anywhere in the mobile client. Separately, several capabilities a company needs are not built server-side at all: platform-wide classroom/group views, per-user block/report views, automated-moderation visibility, and a unified audit trail (`audit_log` has two writers and one narrow reader, and moderation actions bypass it entirely). The operational consequence is a security finding too: without a console, urgent admin actions realistically happen via direct database access, which bypasses both authorization and auditing (`08-SECURITY.md` §6).

**`OBSERVABILITY_READY = NO`** — structured, redacted, correlated logging `EXISTS_NOW` and is good. Everything built *on* logs does not exist: zero external uptime monitoring, zero log aggregation, zero APM or error tracking, zero metrics, zero alerting, zero mobile crash reporting. Logs are not observability.

**`BACKUP_RESTORE_PROVEN = NO`** — well-designed scripts with real safety guards exist, but `git log -- ops/` shows one commit and no recorded execution. By the repository's own standard: *"A backup that has never been restored is a file, not a backup."* There is also no backup schedule at all, making RPO effectively unbounded, and object storage is excluded from backup coverage entirely.

## 2. P0 — required before a broad pilot

**Read the dependency column before sequencing.** Most of these are independent; two are not, and treating #4 as independently executable is the specific mistake this table exists to prevent.

| # | Item | Source | Dependency |
|---|---|---|---|
| 1 | **Run the restore drill for real** against a disposable/staging/sanitized database; verify integrity, schema, rows, migration compatibility, critical queries, and app startup via `/health/ready`; record elapsed time; fix what it finds; then schedule it recurring | `06-BACKUP-RESTORE.md` §3 | **Independent.** Pairs naturally with #10 |
| 2 | **Set `statement_timeout`** on database connections | `02-DATA-STORAGE.md` §4 | **Independent.** Config-only; highest value-per-effort in the set |
| 3 | **Background-job mechanism** — Postgres job table (`status`/`attempts`/`last_error` from the first migration) drained by a scheduled Netlify Function | `01-TARGET-ARCHITECTURE.md` §5 | **Independent.** **Blocks #4** |
| 4 | **Async account-deletion cleanup** — move off the synchronous request path onto the queue, batched | `01-TARGET-ARCHITECTURE.md` §5 | **⚠ ARCHITECTURAL DEPENDENCY — requires #3.** Cannot be started before the job mechanism exists |
| 5 | **Post-deploy `/health/ready` smoke gate + rollback runbook** — the runbook must state the artifact path (Netlify deploy history) *and* the database reality: forward-only migrations mean recovery is a new forward migration or a restore | `01-TARGET-ARCHITECTURE.md` §6 | **Independent.** The runbook's restore path is only *credible* once #1 passes |
| 6 | **External monitoring and alerting** — uptime check on `/health`, standing check on `/health/ready`, log shipping to a searchable store | `05-MONITORING.md` §4 | **Independent.** Constraint: verify the log destination does not re-capture PII at ingestion (`08-SECURITY.md` §2) |
| 7 | **CI dependency-vulnerability + secret scanning** added to the existing `verify` job | `08-SECURITY.md` §5 | **Independent.** CI exists; this is configuration |
| 8 | **Minimum admin console** — user lookup + direct account status change, moderation queue with resolution, system health view | `07-ADMIN-CONTROL-PLANE.md` §5 | **Partially dependent.** Moderation queue and health view are UI-only against existing contracts; **direct status change needs a small server addition** (today it is reachable only as a side effect of report resolution) |
| 9 | **CDN-fronted media reads** replacing the API proxy and `cache-control: private` | `04-MEDIA-CDN.md` §4 | **Independent**, but gated by `NEEDS LIVE VERIFICATION` on edge signature verification. **Must preserve the signed-URL check at the edge** (`08-SECURITY.md` §3) |
| 10 | **Backup access-control verification** — who can run the scripts, where artifacts live, how credentials are scoped | `08-SECURITY.md` §7 | **Independent.** Do it during #1, while the artifacts are already in hand |

**The one hard chain: #3 → #4.** Everything else can run in parallel.

## 3. P1

| # | Item | Source |
|---|---|---|
| 11 | **Decide the realtime option** (accept / long-running host / managed relay) — a product decision that is currently being made by default | `01-TARGET-ARCHITECTURE.md` §4, `03-MESSAGING.md` §2 |
| 12 | Shared-store rate limiter — the one in-memory issue with a security dimension | `01-TARGET-ARCHITECTURE.md` §4 |
| 13 | Latency / error-rate aggregation with thresholds, after a baseline exists | `05-MONITORING.md` §4 |
| 14 | DB pool-saturation visibility; confirm the runtime path uses Neon's pooled endpoint | `02-DATA-STORAGE.md` §4, `05-MONITORING.md` §4 |
| 15 | Orphan sweep job — drains **both** leaks: `listOrphanedFiles` (zero callers) and `orphaned_object_keys` (written, never read). *Depends on #3* | `04-MEDIA-CDN.md` §5 |
| 16 | Per-user storage quota enforcement | `04-MEDIA-CDN.md` §5 |
| 17 | `notifications` pruning; `learning_events` / `analytics_events` retention. *Depends on #3* | `02-DATA-STORAGE.md` §3 |
| 18 | Partition `audit_log` by time range; never delete rows | `02-DATA-STORAGE.md` §3 |
| 19 | Backup schedule (RPO is currently unbounded) and off-host copies. *Only after #1* | `06-BACKUP-RESTORE.md` §4–5 |
| 20 | Evaluate Neon-native PITR as a complement to `ops/`. *Only after #1 establishes a baseline* | `06-BACKUP-RESTORE.md` §7 |
| 21 | `DATABASE_URL` SSL validation in the config schema | `08-SECURITY.md` §4 |
| 22 | Test asserting every admin service export rejects a non-admin actor — converts convention into a checked invariant | `08-SECURITY.md` §6 |
| 23 | Unified audit history (server work first: write moderation actions into `audit_log`), automated-moderation visibility, instructor-verification UI, platform-wide classroom/group admin | `07-ADMIN-CONTROL-PLANE.md` §5 |
| 24 | Media retention / lifecycle policy — product and legal decision, then enforce via #3 | `04-MEDIA-CDN.md` §5 |

## 4. P2

| # | Item | Source |
|---|---|---|
| 25 | Background-job failure/retry monitoring. *Depends on #3* | `05-MONITORING.md` §4 |
| 26 | Storage failure logging and counters | `05-MONITORING.md` §4 |
| 27 | Mobile crash reporting + error boundary — a client dependency/config change, **not** a UI or design-system change | `05-MONITORING.md` §4 |
| 28 | Partition `messages` and archive drained `domain_events` | `02-DATA-STORAGE.md` §3, `03-MESSAGING.md` §5 |
| 29 | Drop the dead `message_receipts` table | `02-DATA-STORAGE.md` §3 |
| 30 | Per-user block/report aggregation views | `07-ADMIN-CONTROL-PLANE.md` §5 |
| 31 | Implement `S3StorageDriver`, or accept Netlify Blobs as the only driver | `04-MEDIA-CDN.md` §1 |
| 32 | Direct-to-storage upload pattern for video/PDF/PPTX — *pattern recorded, not scheduled* | `04-MEDIA-CDN.md` §6 |
| 33 | Read replicas, dedicated broker, long-running host reassessment — *extrapolated tier, re-audit first* | `09-SCALE-PLAN.md` §5 |

## 5. `DOCUMENTATION_DRIFT` follow-ups

Recorded in `00-CURRENT-STATE.md` §10 and deliberately **not** repaired in this PR — silently rewriting architecture history inside an operations PR would destroy the record of what was intended and when it stopped being true.

| # | Item | Priority |
|---|---|---|
| 34 | Update `docs/01-TECHNICAL-ARCHITECTURE.md` §10 to describe the Netlify Function deployment; mark the Dockerfile local-dev/CI-only | P1 |
| 35 | §9's "reserved metric surfaces" — implement or restate as intent; it currently reads as capability | P1 |
| 36 | §11's "queued job table" — reconcile with the real job mechanism once #3 lands | P2 |
| 37 | Add a pointer from `docs/01-TECHNICAL-ARCHITECTURE.md` to `docs/production-ops/` as the operations source of truth | P2 |
| 38 | Correct `docs/app-store/06-APP-REVIEW-NOTES.md`'s description of the messaging fallback as "polling" — it is load-on-demand | P2 |

## 6. `NEEDS LIVE VERIFICATION`

Items this documentation-only audit could not confirm without touching production, listed so they are scheduled rather than assumed:

Netlify Sensitive Variable Policy enabled · Netlify Blobs store private by default · live `DATABASE_URL` SSL enforcement · Neon DB public reachability · live `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` values · Netlify function-log retention and searchability · whether the runtime path uses Neon's pooled endpoint · whether Netlify's CDN can verify signatures at the edge for a private Blobs store · whether Neon PITR is enabled on the live project · backup artifact storage location and access control.

## 7. Non-goals of this PR

No P0/P1/P2 item above is implemented here. This PR lands documentation only: no source, migration, configuration, mobile, design-handoff, test, or workflow file is modified. The brief's one allowance — fixing a small repository defect if needed for truthful evidence — **was not needed**; nothing blocked evidence-gathering.

Implementation is a separate branch: **Production Operations P0 Hardening**.
