#!/usr/bin/env bash
#
# Take a backup.
#
#   DATABASE_URL=postgres://…/studentos ops/backup.sh [destination-directory]
#
# Custom format (`-Fc`), because it is the only one `pg_restore` can restore
# selectively and in parallel — a plain SQL dump is all-or-nothing and, on a
# database with real accounts in it, "all or nothing" is how a partial recovery
# turns into a full outage.
#
# The checksum is written beside the dump and verified by `restore.sh`. A
# corrupted backup that restores half a schema is worse than an absent one,
# because it is discovered during the incident rather than before it.
#
set -euo pipefail

DEST="${1:-${BACKUP_DIR:-./backups}}"
: "${DATABASE_URL:?DATABASE_URL is required}"

# UTC, sortable, and safe in a filename. Local time would make two backups taken
# either side of a clock change sort into the wrong order.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"

ARTIFACT="$DEST/studentos-$STAMP.dump"

# `--no-owner --no-acl`: the restore target is a different database with
# different roles, and a dump that insists on the source's owners fails on
# exactly the day it is needed.
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$ARTIFACT"

sha256sum "$ARTIFACT" | awk '{print $1}' > "$ARTIFACT.sha256"

SIZE="$(du -h "$ARTIFACT" | cut -f1)"
printf '  backup written  %s  (%s)\n' "$ARTIFACT" "$SIZE"

# Retention. Deliberately count-based rather than age-based: a database that
# stops being backed up for a week must not silently lose everything it has.
KEEP="${BACKUP_KEEP:-14}"
mapfile -t OLD < <(ls -1t "$DEST"/studentos-*.dump 2>/dev/null | tail -n "+$((KEEP + 1))")
for stale in "${OLD[@]:-}"; do
  [ -n "$stale" ] || continue
  rm -f "$stale" "$stale.sha256"
  printf '  pruned          %s\n' "$stale"
done
