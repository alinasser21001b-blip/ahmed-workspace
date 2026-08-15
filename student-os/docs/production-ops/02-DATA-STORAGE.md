# 02 — Data Storage (PostgreSQL)

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§2 PostgreSQL**: high-growth tables, indexes, connection pooling, backups, PITR, restore. Backup and restore mechanics — including the unproven-restore finding — are owned by [`06-BACKUP-RESTORE.md`](./06-BACKUP-RESTORE.md); this document covers schema growth and connection handling. Status labels are defined in `00-CURRENT-STATE.md`.

## 1. Provider

**Netlify DB** (`@netlify/database@^1.0.4`), which is Neon-backed Postgres — confirmed by the branch-per-deploy-preview connection resolution in `handler.mts:129-134` and the pooled/unpooled connection-string naming in `netlify-build.sh`, both Neon hallmarks.

**Neon natively supports point-in-time recovery and database branching. Nothing in this repository configures, documents, or relies on that capability** — no ADR, no ops document, no deployment note mentions PITR or branching-as-backup. Whether it is relied on operationally outside the repository is unknown from the code. This is an *unexploited platform capability*, not a defect, and `06-BACKUP-RESTORE.md` owns the decision about it.

## 2. Schema: 16 migrations, `0001`–`0016`, 2,610 lines

Most tables are bounded by construction — reference data, one row per entity, or composite primary keys capped per `(user, entity)` pair (e.g. `learning_progress` PK `(user_id, topic_id)`, `lecture_progress` PK `(user_id, lecture_id)`).

### 2.1 Where the authors already solved unbounded growth

Two precedents, worth quoting because they set the pattern the remaining tables should follow:

- **`content_views`** (`0007_social_and_content.sql:41-44`) — one row per `(user_id, content_id)` with a `view_count` counter, deliberately **not** append-only: *"an append-only impression log would be the single fastest-growing table in the product for no V1 benefit."*
- **`message_receipts`** (`0004_messaging.sql:118-123`) — originally one row per message per recipient. Identified and **abandoned** in `0010_messaging_delivery.sql:1-21`: *"a 200-member group chat writes 200 rows per message... the fastest-growing object in the product."* Replaced by a single `last_delivered_seq` counter column on `conversation_members`. **The old table is left in place, unused.**

Note the difference, because an earlier draft of this document set got it backwards: `content_views` was *designed* for growth; `message_receipts` was *removed from the write path* after the fact. Read/unread and delivery state today live in `conversation_members.last_read_seq` / `last_delivered_seq` — O(1) storage per membership, not per message. `message_receipts` is dead schema.

### 2.2 High-growth tables with no equivalent redesign

| Table | Grows with | Indexes | Retention / partitioning |
|---|---|---|---|
| `messages` | every chat message | `(conversation_id, client_message_id)` unique; `(conversation_id, seq)` unique; `(conversation_id, seq DESC) WHERE deleted_at IS NULL` | none |
| `learning_events` | every learning action, **including non-meaningful kinds** (`lecture_opened`, `resource_opened`, `quiz_started`, …) | `(user_id, occurred_at DESC)`, `(kind, occurred_at DESC)`, `(topic_id, occurred_at DESC)` | **none** |
| `analytics_events` | every product-analytics event | `(name, occurred_at DESC)`, `(user_id, occurred_at DESC)` | **none** |
| `audit_log` | every privileged/admin mutation | `(actor_id, created_at)`, `(target_kind, target_id, created_at)` | **none** |
| `notifications` | every event × its fan-out to recipients — multiplies rows per source event, **plausibly the fastest-growing of this set** | `(user_id, created_at DESC) WHERE read_at IS NULL`, `(user_id, created_at DESC)` | **none** |
| `domain_events` | one row per domain mutation across messaging/content/moderation/social — *"the hottest write path in the product"* per its own migration comment (`0009_phase3_closure.sql:134-140`) | `(occurred_at, id) WHERE processed_at IS NULL` (partial), `(target_type, target_id, occurred_at DESC)`, `(subject_id, kind, occurred_at DESC)` | none, but the partial index makes drained history cheap to skip |

**Indexing is not the gap.** Every table above is indexed for its read patterns; this audit found no missing-index emergency. The gap is that none of `learning_events`, `analytics_events`, `audit_log`, or `notifications` has partitioning, a TTL, or an archival job anywhere in the 16 migrations. These are the tables that will dominate autovacuum load and backup size as usage grows.

One clarification that matters for planning: **`notifications` rows are written, but nothing sends a push** — per `00-CURRENT-STATE.md` §5, push delivery is inert and `domain_events` has no consumer. So the table grows with in-app notification records today, and its growth rate will *increase* if and when delivery is implemented, not begin then.

## 3. Recommendation: retention and partitioning, not a second datastore

Nothing here justifies moving off Postgres or adding a separate time-series/logging store. That would be new infrastructure ahead of evidence.

| Table | Recommended action | Priority |
|---|---|---|
| `notifications` | Prune read rows past a retention window, on the job queue from `01-TARGET-ARCHITECTURE.md` §5 | P1 |
| `learning_events` | Time-based retention or rollup — especially for the non-meaningful kinds, which are pure volume | P1 |
| `analytics_events` | Time-based retention, or export-then-truncate to object storage (not a new database) | P1 |
| `audit_log` | **Partition by time range; never delete rows.** Partitioning is cheap now and expensive as a live migration once the table is large | P1 |
| `domain_events` | Time-based archival of drained (`processed_at IS NOT NULL`) history once retention is defined | P2 |
| `messages` | Partition by time once size affects backup and index maintenance. **Not a deletion policy** — see `03-MESSAGING.md` | P2 |
| `message_receipts` | Dead schema. Consider dropping in a future migration — a housekeeping task, not an operational risk | P2 |

Each retention window is a product and legal decision this audit does not make for them; the technical mechanism, once a window is chosen, is the job queue.

## 4. Connection pooling — the sharpest risk in this document

`db.ts:32-53` — a module-level `pg.Pool` singleton, `max: DATABASE_POOL_MAX` (default 10, bounded 1–100), `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`. One pool per process. No pgbouncer or equivalent is referenced anywhere in the repository.

`netlify-build.sh:73-75` prefers the **unpooled** Neon connection string for migrations specifically, because *"a connection pooler in front of DDL is a known source of confusing failures"* — which implies the **pooled** variant (Neon's own PgBouncer-style pooler, which Netlify DB fronts by default) serves the runtime request path. But that is not explicit in `db.ts`, and **no pooler-aware setting is configured there** — notably nothing disabling prepared statements for PgBouncer transaction mode.

**Two compounding risks:**

1. **Uncoordinated pools.** Each concurrently-warm function instance owns an independent pool of up to 10 connections, with no coordination across instances. Under a genuine traffic spike with many warm instances, this is a credible path to exhausting Neon's server-side connection ceiling.
2. **No `statement_timeout` or `query_timeout` anywhere.** A long-held transaction can hold a pooled connection for its full duration. This is not hypothetical: `03-MESSAGING.md` documents that **every message send in a conversation is serialized by a `SELECT ... FOR UPDATE` row lock on `conversations`** — correct for gapless `seq` assignment, and a real contention point in one hot conversation under concurrent senders. A slow query on an unpartitioned high-growth table from §2.2 has the same effect.

**Recommendations, cheapest first:**

1. **Set `statement_timeout` on connections.** Config-only, no new infrastructure, closes the "runaway query holds a connection indefinitely" mode outright. **The highest value-per-effort change in this entire document set.**
2. **Confirm the runtime path uses Neon's pooled endpoint**, and if so configure the driver accordingly for transaction-mode pooling. Uses a platform capability rather than adding one. Requires a live check — `NEEDS LIVE VERIFICATION`.
3. **Lower per-instance `DATABASE_POOL_MAX`** if steps 1–2 leave total connections unbounded at real concurrency. Tuning, not architecture.
4. Only if 1–3 demonstrably fail at measured load: consider a dedicated pooler process. New infrastructure — do not introduce it ahead of that evidence.

## 5. Migration runner (`EXISTS_NOW`, well-designed)

Three properties, all explicit in `migrate.ts`'s header: a Postgres **advisory lock** (key `8_675_309`) so concurrent cold starts serialize rather than race; **checksum verification** so an applied migration whose contents changed is a hard error, not a silent rewrite; and **per-migration transactionality**, so a failure rolls back only that file and a cold start cut short by the invocation timeout resumes rather than restarting.

The operational consequence, carried into `01-TARGET-ARCHITECTURE.md` §6: migrations are **forward-only with no down-migrations**, by design. Recovery from a bad migration is a new forward migration or a full restore — which makes restore capability a dependency of rollback capability.

## 6. Summary

| Finding | Status | Priority |
|---|---|---|
| No `statement_timeout` configured | `EXISTS_NOW` (as a gap) | **P0** |
| Uncoordinated per-instance pools, pooler-awareness unconfirmed | `PARTIALLY_EXISTS` | P1 + `NEEDS LIVE VERIFICATION` |
| `notifications` unbounded, no pruning | gap | P1 |
| `learning_events` / `analytics_events` unbounded | gap | P1 |
| `audit_log` unpartitioned | gap | P1 |
| `messages` / `domain_events` unpartitioned | gap | P2 |
| `message_receipts` dead schema | housekeeping | P2 |
| Indexes | `EXISTS_NOW`, adequate | — |
| Migration runner safety | `EXISTS_NOW`, well-designed | — |
| Neon PITR/branching | unused platform capability | `06-BACKUP-RESTORE.md` |
