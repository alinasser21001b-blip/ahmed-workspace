#!/usr/bin/env bash
#
# One command to run the whole product locally, with live reload.
#
#   pnpm dev
#
# Brings up the API and the Expo web dev server together, against a database it
# migrates and seeds for you, and prints the URL to open. Both processes reload
# on save: edit a screen and the browser updates, edit the API and it restarts.
#
# Why this exists rather than a list of steps in the README: the list was wrong.
# It said to copy `.env.example` to `.env`, but nothing in the codebase reads a
# `.env` file — configuration comes from the process environment, the way CI
# supplies it. Following the README produced an API that could not find a
# database and an error that did not say so. This script exports what the app
# actually reads, so the documented path and the working path are the same path.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# --- configuration ----------------------------------------------------------
#
# Sourced from apps/api/.env when present, so a developer who has customised
# their setup keeps it, and everyone else gets something that works.

if [ -f apps/api/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./apps/api/.env
  set +a
fi

export NODE_ENV="${NODE_ENV:-development}"
export JWT_SECRET="${JWT_SECRET:-local-development-secret-that-is-long-enough-0123456789}"
export PORT="${PORT:-4000}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

# The client is bundled against this. In development the dev server injects it
# and localhost is the sensible default, so nothing needs setting — but a web
# BUILD (`pnpm --filter @sos/mobile build:web`) refuses to run without it, on
# purpose: a production bundle with no address would silently talk to the
# machine that built it.
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:${PORT}}"

WEB_PORT="${WEB_PORT:-8081}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }

# --- prerequisites ----------------------------------------------------------

command -v node >/dev/null || fail "Node is not installed. This project needs Node 22 or newer."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
  || fail "Node $(node -v) is too old. This project needs Node 22 or newer."

# --- the workspace packages -------------------------------------------------
#
# `@sos/contracts` and `@sos/core` are TypeScript, and both declare
# `"main": "./dist/index.js"`. Nothing can import them until tsc has run — not
# the API, which dies with ERR_MODULE_NOT_FOUND before it can even listen, and
# not Metro, which reports `Unable to resolve "@sos/core"` and refuses to bundle.
#
# This step was missing, and its absence was invisible to anyone who had built
# the repository before: `dist` was simply already there. On a fresh clone —
# which is the only case this script exists to serve — nothing worked, and the
# two errors it produced named modules rather than the missing build, so they
# read like a broken install.

say "Building the workspace packages…"
pnpm -r --filter "./packages/**" build

# --- finding the database ---------------------------------------------------
#
# There is no single connection string that is right everywhere. A Homebrew
# PostgreSQL on macOS trusts the logged-in user and has no `postgres` role at
# all; a Debian package wants `postgres`/`postgres`; a container might want
# something else again. Hardcoding one of them means the script works on the
# machine it was written on and nowhere else — which is exactly what happened:
# the first version defaulted to the Debian string and could not have worked on
# a Mac.
#
# So candidates are tried in order and the first that actually connects wins.
# `DATABASE_URL` from the environment always wins outright.

DB_NAME="${DB_NAME:-studentos_dev}"
DB_TEST_NAME="${DB_TEST_NAME:-studentos_test}"

# The probe runs from apps/api, where `pg` resolves. The earlier version ran it
# from the repository root, where it does not, and so reported "cannot reach
# PostgreSQL" on a machine where PostgreSQL was running perfectly.
probe() {
  ( cd apps/api && node -e "
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.argv[1], connectionTimeoutMillis: 4000 });
    client.connect().then(() => client.end()).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  " "$1" ) >/dev/null 2>&1
}

if [ -n "${DATABASE_URL:-}" ]; then
  CANDIDATES="$DATABASE_URL"
else
  CANDIDATES="postgres://localhost:5432/${DB_NAME}
postgres://${USER:-postgres}@localhost:5432/${DB_NAME}
postgres://postgres:postgres@localhost:5432/${DB_NAME}
postgres://postgres@localhost:5432/${DB_NAME}"
fi

FOUND=""
ADMIN=""
while IFS= read -r candidate; do
  [ -z "$candidate" ] && continue
  if probe "$candidate"; then FOUND="$candidate"; break; fi
  # The server may be up with the database simply not created yet. Ask the
  # maintenance database, which always exists, using the same credentials.
  maintenance="${candidate%/*}/postgres"
  if [ -z "$ADMIN" ] && probe "$maintenance"; then ADMIN="$maintenance"; fi
done <<EOF
$CANDIDATES
EOF

if [ -z "$FOUND" ] && [ -n "$ADMIN" ]; then
  say "Creating the databases…"
  for db in "$DB_NAME" "$DB_TEST_NAME"; do
    ( cd apps/api && node -e "
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.argv[1] });
      client.connect()
        .then(() => client.query('CREATE DATABASE \"' + process.argv[2] + '\"'))
        .catch((error) => { if (error.code !== '42P04') throw error; })
        .then(() => client.end())
        .then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
    " "$ADMIN" "$db" ) || fail "Could not create the database \"$db\"."
    printf '  created %s\n' "$db"
  done
  FOUND="${ADMIN%/*}/${DB_NAME}"
fi

if [ -z "$FOUND" ]; then
  fail "Could not connect to PostgreSQL.

  Tried:
$(printf '    %s\n' $CANDIDATES)

  Make sure PostgreSQL is running:

    macOS    brew services start postgresql@16
    Linux    sudo service postgresql start

  Or set DATABASE_URL yourself and run this again."
fi

export DATABASE_URL="$FOUND"

# --- database ---------------------------------------------------------------
#
# Anything past the TCP check — wrong password, missing database — is reported
# by the migrator itself, which has the real client and the real error. The hint
# is added here because the most common cause is simply that the database has
# not been created yet.

say "Preparing the database…"
if ! pnpm db:migrate; then
  fail "The migrations could not run.

  If the database does not exist yet:

    createdb studentos_dev

  If the credentials are wrong, set DATABASE_URL and run this again."
fi

# The academic hierarchy. Safe to re-run: it upserts.
pnpm db:seed

# --- the two servers --------------------------------------------------------
#
# Started together and stopped together. Without the trap, Ctrl-C would kill
# this script and leave both children holding their ports, so the next run would
# fail with EADDRINUSE and no explanation.

API_PID=""
WEB_PID=""
WATCH_PIDS=""
cleanup() {
  trap - INT TERM EXIT
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  for pid in $WATCH_PIDS; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup INT TERM EXIT

# The packages are compiled, so an edit to one is invisible until tsc runs
# again. `@sos/core` is the authorization layer; a stale copy of it would mean
# testing a permission change against the previous permission rules, and getting
# a confident, wrong answer. Watching costs two idle processes and removes that
# entirely.
for package in contracts core; do
  ( cd "packages/$package" && exec pnpm exec tsc -p tsconfig.json --watch --preserveWatchOutput ) \
    >/dev/null 2>&1 &
  WATCH_PIDS="$WATCH_PIDS $!"
done

say "Starting the API on http://localhost:${PORT}…"
pnpm dev:api &
API_PID=$!

# Wait for readiness before seeding the demo cohort, which talks to it over HTTP.
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${PORT}/health/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done

if curl -sf "http://localhost:${PORT}/health/ready" >/dev/null 2>&1; then
  # Demo content, so the app has something in it. Idempotent — a second run
  # detects the cohort and does nothing.
  pnpm --filter @sos/api demo:seed || true
else
  printf '\n\033[33m⚠ The API did not become ready; continuing without demo data.\033[0m\n'
fi

say "Starting the web client on http://localhost:${WEB_PORT}…"
pnpm --filter @sos/mobile exec expo start --web --port "${WEB_PORT}" &
WEB_PID=$!

cat <<BANNER

──────────────────────────────────────────────────────────────
  Open:  http://localhost:${WEB_PORT}

  Sign in with any of the demo accounts:

    amjad@uob.edu.iq    — verified instructor, and the platform
                          administrator: sees the join code, the
                          draft lecture, and can open a classroom
    zainab@uob.edu.iq   — ordinary student
    omar@uob.edu.iq     — ordinary student

    password: correct-horse-battery

  Everything reloads on save — the screens, the API, and the
  policy packages. Ctrl-C stops them all together.
──────────────────────────────────────────────────────────────

BANNER

wait
