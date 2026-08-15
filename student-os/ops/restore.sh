#!/usr/bin/env bash
#
# Restore a backup into a database.
#
#   ops/restore.sh backups/studentos-20260814T221500Z.dump postgres://…/target
#
# The target is an explicit argument and never `DATABASE_URL`. Reading the
# target from the environment is how a restore lands on the database it was
# taken from — the one case where the operator is under the most pressure and
# has the least attention to spare.
#
set -euo pipefail

ARTIFACT="${1:?usage: ops/restore.sh <dump-file> <target-database-url>}"
TARGET="${2:?usage: ops/restore.sh <dump-file> <target-database-url>}"

[ -f "$ARTIFACT" ] || { printf '\n✗ no such backup: %s\n\n' "$ARTIFACT" >&2; exit 1; }

# --- the checksum -----------------------------------------------------------

if [ -f "$ARTIFACT.sha256" ]; then
  EXPECTED="$(cat "$ARTIFACT.sha256")"
  ACTUAL="$(sha256sum "$ARTIFACT" | awk '{print $1}')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    printf '\n✗ checksum mismatch — this backup is not the one that was written.\n\n' >&2
    exit 1
  fi
  printf '  checksum ok\n'
else
  printf '  ⚠ no checksum beside this backup; restoring anyway\n'
fi

# --- the guard --------------------------------------------------------------
#
# A restore drops and recreates every object it touches, so it is destructive
# by construction. Requiring the target to be named as a restore target — or the
# operator to say ALLOW_PRODUCTION_RESTORE out loud — is the difference between
# a recovery and a second incident.

case "$TARGET" in
  *_restore|*_restore\?*|*_test|*_test\?*|*_dev|*_dev\?*|*_scratch|*_scratch\?*) ;;
  *)
    if [ "${ALLOW_PRODUCTION_RESTORE:-}" != "yes" ]; then
      printf '\n✗ refusing: the target does not look like a restore target.\n\n' >&2
      printf '  Restore into a scratch database and promote it, or set\n' >&2
      printf '  ALLOW_PRODUCTION_RESTORE=yes if you really mean this one.\n\n' >&2
      exit 1
    fi
    printf '  ⚠ restoring into a non-scratch target, as explicitly allowed\n'
    ;;
esac

# `--clean --if-exists` so a re-run is idempotent; `--single-transaction` so a
# failure leaves the target as it was rather than half-restored.
pg_restore \
  --dbname="$TARGET" \
  --clean --if-exists \
  --no-owner --no-acl \
  --single-transaction \
  "$ARTIFACT"

printf '  restored        %s\n' "$ARTIFACT"
