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

# The API and the client are served from the same origin, so the client's API
# address is simply the site's own URL. `DEPLOY_PRIME_URL` is this deploy's URL
# (a preview gets its own); `URL` is the production one. Preferring the former
# means a deploy preview talks to its own API and its own database branch rather
# than reaching across into production.
export EXPO_PUBLIC_API_URL="${DEPLOY_PRIME_URL:-${URL:-}}"

if [ -z "$EXPO_PUBLIC_API_URL" ]; then
  printf 'Neither DEPLOY_PRIME_URL nor URL is set; cannot determine the site address.\n' >&2
  exit 1
fi

printf '\nBuilding against %s\n\n' "$EXPO_PUBLIC_API_URL"

# Workspace packages first, then the API: the function imports `apps/api/dist`,
# which does not exist until tsc has run.
pnpm build

# `build:web` refuses to run without EXPO_PUBLIC_API_URL, which is the guarantee
# that the bundle above is not the one that quietly points at localhost.
pnpm --filter @sos/mobile build:web
