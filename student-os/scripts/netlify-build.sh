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
