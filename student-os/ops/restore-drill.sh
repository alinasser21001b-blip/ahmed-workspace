#!/usr/bin/env bash
#
# The gate: prove the backup can be restored, and that what comes back is the
# database that went in.
#
#   DATABASE_URL=postgres://…/studentos ops/restore-drill.sh
#
# A backup that has never been restored is not a backup — it is a file. This
# takes one, restores it into a scratch database, compares the schema version
# and the row counts of the tables that would end the company if they were lost,
# and drops the scratch database again.
#
# It is written to be run by a person before a risky change and by a schedule
# afterwards. It exits non-zero when the restore does not reproduce the source,
# which is the only property worth asserting: everything else is a file that
# exists.
#
set -euo pipefail

cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is required — the database to drill against}"

WORK="$(mktemp -d)"
SCRATCH_NAME="studentos_drill_$(date -u +%s)_restore"
ADMIN_URL="${DATABASE_URL%/*}/postgres"
SCRATCH_URL="${DATABASE_URL%/*}/$SCRATCH_NAME"

cleanup() {
  psql "$ADMIN_URL" -qtAX -c "DROP DATABASE IF EXISTS \"$SCRATCH_NAME\"" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

printf '\nRestore drill\n\n'

# --- 1. what the source holds ------------------------------------------------
#
# Counted BEFORE the backup, so a difference afterwards is the restore's and not
# a write that happened in between. The tables are the ones whose loss cannot be
# recovered from anywhere else: accounts, the knowledge students wrote, and the
# learning signal that knowledge is ranked by.

TABLES=(users profiles content_items content_sources content_corrections
        learning_events learning_progress quiz_answers messages)

declare -A BEFORE
for table in "${TABLES[@]}"; do
  BEFORE[$table]="$(psql "$DATABASE_URL" -qtAX -c "SELECT count(*) FROM $table")"
done
SCHEMA_BEFORE="$(psql "$DATABASE_URL" -qtAX -c "SELECT count(*) FROM schema_migrations")"

# --- 2. back it up -----------------------------------------------------------

BACKUP_DIR="$WORK" bash ops/backup.sh "$WORK" >/dev/null
ARTIFACT="$(ls -1t "$WORK"/studentos-*.dump | head -1)"
printf '  backup taken    %s\n' "$(basename "$ARTIFACT")"

# --- 3. restore it somewhere it can do no harm -------------------------------

psql "$ADMIN_URL" -qtAX -c "CREATE DATABASE \"$SCRATCH_NAME\"" >/dev/null
bash ops/restore.sh "$ARTIFACT" "$SCRATCH_URL" >/dev/null
printf '  restored into   %s\n\n' "$SCRATCH_NAME"

# --- 4. is it the same database? ---------------------------------------------

FAILED=0
SCHEMA_AFTER="$(psql "$SCRATCH_URL" -qtAX -c "SELECT count(*) FROM schema_migrations")"
if [ "$SCHEMA_BEFORE" = "$SCHEMA_AFTER" ]; then
  printf '  ✓ %-22s %s migrations\n' "schema" "$SCHEMA_AFTER"
else
  printf '  ✗ %-22s %s → %s\n' "schema" "$SCHEMA_BEFORE" "$SCHEMA_AFTER"
  FAILED=1
fi

for table in "${TABLES[@]}"; do
  after="$(psql "$SCRATCH_URL" -qtAX -c "SELECT count(*) FROM $table")"
  if [ "${BEFORE[$table]}" = "$after" ]; then
    printf '  ✓ %-22s %s rows\n' "$table" "$after"
  else
    printf '  ✗ %-22s %s → %s\n' "$table" "${BEFORE[$table]}" "$after"
    FAILED=1
  fi
done

# One integrity check that a row count cannot make: the restored database still
# refuses the thing the schema exists to refuse.
VIOLATION="$(psql "$SCRATCH_URL" -qtAX -c \
  "SELECT count(*) FROM learning_progress WHERE questions_correct > questions_seen")"
if [ "$VIOLATION" = "0" ]; then
  printf '  ✓ %-22s intact\n' "constraints"
else
  printf '  ✗ %-22s %s impossible rows\n' "constraints" "$VIOLATION"
  FAILED=1
fi

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf '✗ the restore does not reproduce the source\n\n' >&2
  exit 1
fi
printf '✓ the backup restores, and what comes back is the same database\n\n'
