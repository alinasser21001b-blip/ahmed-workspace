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
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/studentos_dev}"
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

# Is anything listening? Deliberately a bare TCP check using Node's built-in
# `net`, and NOT the `pg` client: `pg` belongs to apps/api and does not resolve
# from the repository root, so requiring it here reported "cannot reach
# PostgreSQL" on a machine where PostgreSQL was running perfectly. A check that
# can fail for a reason other than the one it names is worse than no check.
if ! node -e "
  const net = require('node:net');
  const url = new URL(process.env.DATABASE_URL);
  const socket = net.connect(Number(url.port || 5432), url.hostname);
  socket.setTimeout(4000);
  socket.on('connect', () => { socket.end(); process.exit(0); });
  socket.on('timeout', () => process.exit(1));
  socket.on('error', () => process.exit(1));
" 2>/dev/null; then
  fail "Nothing is listening for PostgreSQL at the address in DATABASE_URL.

    ${DATABASE_URL%%\?*}

  Start PostgreSQL and run this again, or point DATABASE_URL elsewhere."
fi

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
cleanup() {
  trap - INT TERM EXIT
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

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

  Both servers reload on save. Ctrl-C stops them together.
──────────────────────────────────────────────────────────────

BANNER

wait
