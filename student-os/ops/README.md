# Operations

This directory was empty. The database now holds real accounts, the knowledge
students wrote, and — since Phase 5d — the learning signal that knowledge is
ranked by. None of it exists anywhere else.

Three scripts, and a runbook for the only two situations that matter.

| Script | What it does |
| --- | --- |
| `backup.sh` | Takes a `pg_dump` in custom format, writes a SHA-256 beside it, prunes to the last 14 |
| `restore.sh` | Verifies the checksum, refuses a target that is not a restore target, restores in one transaction |
| `restore-drill.sh` | **The gate.** Backs up, restores into a scratch database, and asserts what comes back is the same database |

## The gate

A backup that has never been restored is a file, not a backup. `restore-drill.sh`
is what turns one into the other: it counts the rows that cannot be recovered
from anywhere else, takes a backup, restores it somewhere it can do no harm,
compares, and exits non-zero if the two disagree.

```sh
DATABASE_URL=postgres://…/studentos ops/restore-drill.sh
```

Run it before any migration that rewrites data, and on a schedule otherwise. It
drops its scratch database on the way out, including when it fails.

## Taking a backup

```sh
DATABASE_URL=postgres://…/studentos ops/backup.sh /var/backups/studentos
```

Custom format, compressed, no owners and no ACLs — the restore target has
different roles, and a dump that insists on the source's owners fails on exactly
the day it is needed.

Retention is count-based (`BACKUP_KEEP`, default 14) rather than age-based, so a
database that stops being backed up for a fortnight does not silently lose
everything it has.

## Restoring

```sh
ops/restore.sh /var/backups/studentos/studentos-20260814T221500Z.dump \
  postgres://…/studentos_restore
```

The target is an argument and never `DATABASE_URL`. Reading it from the
environment is how a restore lands on the database it was taken from, in the one
situation where the operator has the least attention to spare. A target whose
name does not end in `_restore`, `_test`, `_dev` or `_scratch` is refused unless
`ALLOW_PRODUCTION_RESTORE=yes` is set deliberately.

The recovery shape is therefore: restore into a scratch database, check it, then
promote it — not "restore over production and hope".

## What this covers, and what it does not

**Covered.** Everything in Postgres: accounts, profiles, content, provenance,
messages, learning events and learning progress. A restore reproduces the schema
at the migration version the backup was taken at, so the application does not
need to be rolled back with it.

**Not covered yet, and stated rather than implied:**

* **Uploaded files.** Media lives in the storage driver, not the database. A
  restore brings back the rows that point at objects; it does not bring back the
  objects. On the deployed configuration that is Netlify Blobs, whose own
  durability is what stands behind those files today.
* **Off-host copies.** These scripts write where you tell them to. A backup on
  the same machine as the database survives a bad migration and does not survive
  the machine. Copying the artifacts somewhere else is a deployment decision and
  has not been made.
* **A schedule.** Nothing runs these automatically. The drill is the gate; wiring
  it to a timer is the next step and is deliberately not smuggled in here.

**Objectives, as they actually stand.** RPO is the age of the newest backup —
with no schedule, that is "whenever someone last ran it", which is the honest
answer and not a good one. RTO on the demo-sized database is under a minute;
it has not been measured at production size because production is not that size
yet.
