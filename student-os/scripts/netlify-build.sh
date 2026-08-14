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

printf '\nBuilding the client against its own origin\n\n'

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
# `NETLIFY_DATABASE_URL` is provided by the database extension. If it is absent
# — the very first build, before the database exists — this is skipped and the
# function's own fallback covers it.
# Unpooled where it is offered: these are schema changes, and a connection
# pooler in front of DDL is a known source of confusing failures.
DEPLOY_DATABASE_URL="${NETLIFY_DATABASE_URL_UNPOOLED:-${NETLIFY_DATABASE_URL:-}}"

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
