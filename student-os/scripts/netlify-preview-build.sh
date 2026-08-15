#!/usr/bin/env bash
#
# The build a Deploy Preview runs. Production runs `netlify-build.sh`; this is
# deliberately a different script rather than the same one with a flag.
#
# The difference is the entire safety argument for showing this to students, so
# it is written out rather than inferred:
#
#   netlify-build.sh                    this script
#   ────────────────────────────────    ──────────────────────────────────
#   builds the API function             does not
#   runs db:migrate                     does not
#   runs db:seed                        does not
#   client talks to the deployed API    client talks to an in-memory fixture
#
# A preview cannot reach the production database because this script never
# resolves a connection string, and it cannot reach the production API because
# it never produces a function for the site to route `/v1/*` to. Both are
# absences, not settings — there is nothing here to misconfigure, and no
# environment variable whose value could quietly turn either back on.
#
# The one thing it must set is the flag, and it sets it in `netlify.toml` under
# the deploy-preview context rather than in the Netlify UI, so the reason a
# build is a fixture build is reviewable in a diff.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${EXPO_PUBLIC_PREVIEW_MODE:-}" != "1" ]; then
  printf '\n  ✗ Refusing to run the preview build without EXPO_PUBLIC_PREVIEW_MODE=1.\n\n' \
    >&2
  printf '    This script exists to produce a fixture-only bundle. Without the\n' >&2
  printf '    flag the export would build a client that talks to a real API, and\n' >&2
  printf '    publish it at a URL handed to students.\n\n' >&2
  exit 1
fi

# Same-origin, as in production — but this build never issues a request, so the
# value is only here because the export refuses to run without an address. The
# address with no host is the one that cannot be the wrong host.
export EXPO_PUBLIC_API_URL=same-origin

printf '\nBuilding the student preview — fixtures only, no API, no database\n\n'

# Workspace packages, because the client type-checks and imports against them.
# Note this is NOT `pnpm build`, which would also build the API.
pnpm --filter @sos/contracts --filter @sos/core build

pnpm --filter @sos/mobile build:web

# Deliberately absent, and each absence is load-bearing:
#
#   node scripts/bundle-function.mjs   ← no function is produced, so the site
#                                        has nothing to route /v1/* to and the
#                                        API cannot be reached from this deploy
#   pnpm db:migrate / db:seed          ← no connection string is ever resolved,
#                                        so no database is touched, created or
#                                        provisioned by this build

printf '\nPreview build complete. No function was bundled and no database was contacted.\n\n'
