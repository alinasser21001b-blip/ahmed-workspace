# 06 — Backups and Disaster Recovery

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§7 Backups and disaster recovery**: strategy, retention, restore drill, RPO/RTO. Constraint from the brief: **do not claim backups are safe until restoration has been tested.** This document makes no such claim.

## 1. What exists (`EXISTS_NOW`, and it is good)

`ops/backup.sh`, `ops/restore.sh`, `ops/restore-drill.sh`, `ops/README.md` — all committed together in `0cc2d18` (2026-08-14).

| Script | What it does |
|---|---|
| `backup.sh` | `pg_dump` in custom format, writes a SHA-256 beside it, prunes to the last 14 (`BACKUP_KEEP`) |
| `restore.sh` | Verifies the checksum, **refuses a target that is not a restore target**, restores in one transaction |
| `restore-drill.sh` | Backs up, restores into a **scratch database**, asserts what comes back is the same database, and **drops the scratch database on the way out, including on failure** |

The design quality is genuinely high, and the safety properties are already the ones §4 of this document would otherwise have to ask for:

- **Custom format, compressed, no owners and no ACLs** — because *"the restore target has different roles, and a dump that insists on the source's owners fails on exactly the day it is needed."*
- **The restore target is an argument and never `DATABASE_URL`.** Reading it from the environment is *"how a restore lands on the database it was taken from, in the one situation where the operator has the least attention to spare."*
- **A target whose name does not end in `_restore`, `_test`, `_dev`, or `_scratch` is refused** unless `ALLOW_PRODUCTION_RESTORE=yes` is set deliberately.
- **Count-based retention (14), not age-based** — *"so a database that stops being backed up for a fortnight does not silently lose everything it has."*
- The stated recovery shape is *"restore into a scratch database, check it, then promote it — not 'restore over production and hope'."*

`ops/README.md` also states its own gaps rather than implying safety it does not have. That honesty is why this audit can be specific.

## 2. The central finding: the drill has never been run

**`git log --oneline -- ops/` returns exactly one commit.** The scripts were written and asserted correct in isolation. **There is no evidence in git history, CI, or any repository artifact that `restore-drill.sh` has ever been executed against a real database.**

`ops/README.md` states the drill's own purpose better than this audit could: *"A backup that has never been restored is a file, not a backup."* By that standard — the repository's own — what exists today is a set of files and a well-reasoned intention.

This is not pedantry. The failure modes a never-executed drill cannot rule out are the ordinary ones:

- A dump that completes without error but omits something added after the script was last reviewed.
- A restore that succeeds structurally but leaves the schema in a state the application cannot run against — migration-state mismatch, sequence drift, a missing extension.
- Environment drift: a credential path, database name, or `pg_dump`/server version pairing that was valid at authoring time and is not now.
- **Timing.** Nobody has measured how long a restore takes at production size — and that is precisely the number an RTO commitment is made of.

**Per the brief's constraint, this document states directly: backups are not proven safe, because restoration has not been tested.** Script quality is evidence of care. It is not evidence of recovery.

## 3. `RECOMMENDED` (P0): run the drill — safely

**This is the highest-priority item in the entire audit**, because every other recommendation in this document set assumes data durability that is currently unverified. It requires no new infrastructure: the tooling exists.

### 3.1 Non-negotiable safety constraints

**No step of this work may touch production data.** Specifically, and these are requirements on the *implementation phase*, not this PR:

- Run against a **disposable database** — a scratch database, a staging environment, or a **sanitized snapshot** of production. Never against the production database.
- **Never restore over production.** `restore.sh`'s name-suffix guard already enforces this; **do not set `ALLOW_PRODUCTION_RESTORE=yes` to work around it.** That flag exists for a genuine disaster, not for a drill.
- **No destructive operation against production storage, live backups, or user data.** The drill reads a backup and writes a scratch database; it must never drop, truncate, or mutate anything else.
- If a production-derived snapshot is used, it must be **sanitized** before the drill — this is a database holding real student accounts, private messages, and learning records.

`restore-drill.sh` was already written to these constraints (scratch database, dropped on exit including on failure). The requirement here is to **not defeat them under time pressure**, which is the realistic risk.

### 3.2 What the drill must verify

Running it is necessary but not sufficient — a green exit code proves less than it appears unless these are checked:

1. **Backup integrity** — the SHA-256 written by `backup.sh` verifies.
2. **Schema restoration** — the restored schema matches the migration version the backup was taken at.
3. **Row integrity** — row counts and constraints match, for the tables that cannot be reconstructed from anywhere else (accounts, content, messages, learning events and progress). This is what `restore-drill.sh` already asserts.
4. **Migration compatibility** — `isSchemaCurrent()` agrees: migration files on disk equal `schema_migrations` rows. This is the same check `/health/ready` runs.
5. **Critical application queries** — a handful of real read paths (login, conversation list, feed) execute correctly against the restored database.
6. **Application startup after restore** — point an API instance at the restored database and confirm **`/health/ready` returns `200`**. This is the cheapest end-to-end proof available and it already exists: if a restored database cannot pass readiness, the restore is not done.
7. **Elapsed time**, recorded — this is the input to the RTO number in §6, which cannot honestly be stated without it.

### 3.3 Then make it recurring

A restore path that worked once, months ago, against a since-changed schema is not meaningfully different from one never run. `ops/README.md` already says so: *"Run it before any migration that rewrites data, and on a schedule otherwise."* **Nothing runs these automatically today.**

`RECOMMENDED`: wire the drill to a schedule, and treat a drill failure as a P0 incident rather than a backlog item. The README is explicit that wiring it to a timer *"is the next step and is deliberately not smuggled in here"* — that next step is still not taken.

## 4. Retention, off-host copies, and what backups do not cover

Three gaps, all stated plainly in `ops/README.md` itself:

- **Retention** (`EXISTS_NOW`): count-based, last 14 backups (`BACKUP_KEEP`). Sound as a mechanism. What is undefined is the *policy* — 14 of what cadence? With no schedule (§5), "14 backups" is not a time window.
- **No off-host copies** (`RECOMMENDED`): *"A backup on the same machine as the database survives a bad migration and does not survive the machine. Copying the artifacts somewhere else is a deployment decision and has not been made."* This is a real single-point-of-failure and it is deliberately unresolved.
- **Object storage is not covered** (`RECOMMENDED`): *"A restore brings back the rows that point at objects; it does not bring back the objects."* Uploaded media is backed only by Netlify Blobs' own durability. A database restore therefore produces a consistent database with **dangling media references** — which must be understood before a real recovery, not during one. See `04-MEDIA-CDN.md`.

## 5. No schedule exists

**Nothing runs `backup.sh` automatically.** There is no cron, no scheduled Function, no CI job. Backups happen when a human remembers.

This is the single most consequential operational fact in this document after §2, and it directly determines RPO (§6). It is also a natural first consumer of the scheduled-Function mechanism recommended in `01-TARGET-ARCHITECTURE.md` §5 — though note the ordering dependency: **scheduling backups of an unproven restore path adds frequency, not safety.** Run the drill first.

## 6. RPO / RTO

`ops/README.md` states the current position honestly, and this audit adopts its framing:

**Current, actual:**

- **RPO** — *"the age of the newest backup — with no schedule, that is 'whenever someone last ran it', which is the honest answer and not a good one."* Effectively **unbounded**.
- **RTO** — the README asserts *"under a minute"* on a demo-sized database, and states it *"has not been measured at production size because production is not that size yet."* No drill run is recorded in git history, so treat even the demo figure as an authoring-time assertion rather than a measurement.

**Proposed targets** — calibrated to an early-stage student platform, and offered explicitly as *targets to adopt*, not as descriptions of current capability:

| | Target | Rationale |
|---|---|---|
| **RPO** | **≤ 24 hours** | For a platform with no payment processing and no safety-critical realtime data, losing up to a day in a true disaster is survivable, and matches a daily schedule without continuous-replication infrastructure. Requires §5's schedule to exist at all |
| **RTO** | **≤ 4 hours** | Deliberately loose, because the honest input number does not exist yet. Measure it in §3.2 step 7; if the real figure is materially worse, closing that gap becomes the next task rather than something quietly accepted |

**Both targets are provisional until the P0 drill runs.** Stating a target is not claiming it is met, and this document does not conflate the two.

## 7. The unused platform capability: Neon PITR

Netlify DB is Neon-backed, and Neon provides **native point-in-time recovery and database branching**. **Nothing in this repository configures, documents, or relies on it** (`02-DATA-STORAGE.md` §1) — the `ops/` scripts implement backup and restore entirely independently.

`RECOMMENDED`, **after** §3's drill establishes a baseline: evaluate Neon-native PITR as a complement to the scripts.

- Neon PITR is typically continuous rather than periodic-snapshot, which would be a materially stronger RPO than any cron-driven `pg_dump` — potentially closing §5's gap without building a schedule at all.
- **The custom scripts remain valuable regardless.** A self-controlled, portable dump is a reasonable hedge against platform-specific failure or a future migration off Netlify DB, and produces an artifact independent of the Neon control plane.
- **This is an evaluation, not a mandate to remove anything.** Do not treat this section as license to delete `ops/`. And the evaluation must come *after* the drill, so there is a real baseline to compare against.

Whether PITR is enabled on the live project is `NEEDS LIVE VERIFICATION`.

## 8. Summary

| Item | Status | Priority |
|---|---|---|
| Backup / restore / drill scripts, well-designed with real safety guards | `EXISTS_NOW` | — |
| **Drill has ever actually been run** | **No — one commit, no recorded execution** | **P0** |
| Application-startup verification after restore (`/health/ready`) | `RECOMMENDED` | P0, part of the drill |
| Recurring drill schedule | does not exist | P0, immediately after |
| Backup schedule of any kind | **does not exist — RPO effectively unbounded** | P1 |
| Off-host backup copies | does not exist, deliberately unresolved | P1 |
| Object storage excluded from backups | `EXISTS_NOW` (stated gap) | P1 |
| Backup retention *policy* (vs. the count mechanism) | undefined | P1 |
| Neon-native PITR evaluated | unused capability | P1, after the drill |
| Backup artifact access control | not verified | `NEEDS LIVE VERIFICATION` — `08-SECURITY.md` §7 |
| RPO / RTO targets | undocumented; proposed here | adopt as targets, measure via the drill |

**`BACKUP_RESTORE_PROVEN = NO`** — carried into `10-IMPLEMENTATION-PLAN.md`, on the strength of §2.
