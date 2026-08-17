#!/usr/bin/env bash
#
# The build Netlify runs.
#
# Kept as a script rather than a one-liner in netlify.toml so that the one thing
# that must not go wrong is visible and commented: the client bundle is frozen
# at build time, and the address it is frozen with is the address it will use
# forever. There is no environment to read in a browser.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# The dedicated preview site builds fixtures, never the real system.
#
# `student-os-preview`'s production branch is the preview branch, so its
# deploys run this script in the *production* context — which builds the API
# function and, when a database is attached, migrates and seeds it. That is
# exactly what a student preview must never do. The first deploy after the
# site's base directory was fixed did it: one live function, a real client,
# published at the preview URL.
#
# The site therefore carries EXPO_PUBLIC_PREVIEW_MODE=1 in its own Netlify
# environment, and this guard hands the whole build to the preview script:
# fixture client, no function bundled (so /v1/* has nothing to reach), no
# connection string ever resolved, no migration, no seed. Fail-closed by
# construction — the real production site never sets the variable, and an
# unset variable takes the unchanged path below.
# ---------------------------------------------------------------------------
if [ "${EXPO_PUBLIC_PREVIEW_MODE:-}" = "1" ]; then
  printf '\nEXPO_PUBLIC_PREVIEW_MODE=1 — building the fixture preview, not the system\n\n'
  exec bash "$(dirname "$0")/netlify-preview-build.sh"
fi

# The API and the client are served from the same origin, so the client does not
# need to be told a host at all — it uses whichever one served the page.
#
# This used to bake `DEPLOY_PRIME_URL` in, and that was wrong twice over on the
# first real deploy: the value was the deploy's own branch subdomain, which is
# not where anyone opens the site, and it was `http://`, which a browser blocks
# as mixed content inside an `https://` page. Either way `fetch` throws before a
# request leaves the tab, and the app reports "no internet connection" while the
# API is healthy on the very host the page came from.
#
# A build that names no host cannot name the wrong one. It also means a deploy
# preview talks to its own API and its own database branch for free, which is
# what the DEPLOY_PRIME_URL version was reaching for in the first place.
export EXPO_PUBLIC_API_URL=same-origin

# Realtime off, because this host cannot serve it.
#
# The WebSocket server and its client are both complete and both work against
# the long-lived Fastify process. A Netlify Function cannot hold a connection
# open — it is invoked per request and answers through `app.inject()` — so the
# upgrade at /v1/realtime fails every time. Left unsaid, the client would retry
# on a jittered backoff for the entire session against an endpoint that can
# never answer.
#
# This is a statement about the host, not a feature switch: messaging still
# sends and loads over HTTP, and both chat screens carry the translated line
# saying live delivery is unavailable. Moving the API to a runtime that can
# hold a socket is the documented unblock (09-EXTERNAL-SERVICES.md); such a
# build simply does not set this.
export EXPO_PUBLIC_REALTIME=0

printf '\nBuilding the client against its own origin (realtime disabled: this host cannot hold a socket)\n\n'

# Workspace packages first, then the API: the function imports `apps/api/dist`,
# which does not exist until tsc has run.
pnpm build

# `build:web` refuses to run without EXPO_PUBLIC_API_URL, which is the guarantee
# that the bundle above is not the one that quietly points at localhost.
pnpm --filter @sos/mobile build:web

# The API function, bundled into something a file tracer cannot get wrong. See
# scripts/bundle-function.mjs for why this cannot be left to Netlify.
node scripts/bundle-function.mjs

# --- the schema -------------------------------------------------------------
#
# Migrations belong here, not on the first request.
#
# The function does run them at boot, and that is a correct fallback — the
# migrator takes an advisory lock and commits each migration on its own, so
# concurrent cold starts serialise safely. What it is not is *fast*: building
# twelve migrations into an empty database, from a cold instance, against a
# database that is itself waking up, has to finish inside a single invocation's
# budget. When it does not, the request dies mid-way and the caller gets a
# platform error page rather than anything the app can explain — which is
# exactly as opaque as it sounds from the outside.
#
# Doing it here instead means it happens once, with no timeout over it, and a
# failure stops the deploy loudly rather than surfacing later as a sign-in that
# does not work.
#
# Which variable holds the connection string.
#
# `NETLIFY_DB_URL` is the one the current contract uses, and that is not a
# preference: `@netlify/database@1.1.0` reads exactly that key and nothing else
# — `getConnectionString()` calls `env.get("NETLIFY_DB_URL")` and throws
# `MissingDatabaseConnectionError` when it is unset.
#
# This script previously checked only `NETLIFY_DATABASE_URL` and
# `NETLIFY_DATABASE_URL_UNPOOLED`, names the contract does not use. Neither is
# ever set, so the condition below was always false, and every build printed
# "no database URL" and skipped the migrations — silently, in the branch of an
# `if` that looks like it is handling a rare first-build case. The older names
# are still tried, after the current one, for a deployment that predates the
# rename; unpooled is preferred where offered because these are schema changes
# and a connection pooler in front of DDL is a known source of confusing
# failures.
DEPLOY_DATABASE_URL="${NETLIFY_DB_URL:-${NETLIFY_DATABASE_URL_UNPOOLED:-${NETLIFY_DATABASE_URL:-}}}"

# Which key was found, never what is in it — this line goes to a build log.
for candidate in NETLIFY_DB_URL NETLIFY_DATABASE_URL_UNPOOLED NETLIFY_DATABASE_URL; do
  eval "value=\${$candidate:-}"
  if [ -n "$value" ]; then printf '  database connection string found in %s\n' "$candidate"; break; fi
done

if [ -n "$DEPLOY_DATABASE_URL" ]; then
  printf '\nMigrating and seeding the deployed database\n\n'
  # JWT_SECRET is validated at config load but is only ever used to sign tokens,
  # which nothing here does. A throwaway value keeps the real signing key scoped
  # to the functions that actually need it rather than widening it to builds.
  DATABASE_URL="$DEPLOY_DATABASE_URL" \
  JWT_SECRET="build-step-only-never-signs-anything-0123456789" \
    pnpm db:migrate

  DATABASE_URL="$DEPLOY_DATABASE_URL" \
  JWT_SECRET="build-step-only-never-signs-anything-0123456789" \
    pnpm db:seed
else
  printf '\nNo database URL at build time; the function will migrate on first request.\n\n'
fi
