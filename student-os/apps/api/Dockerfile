# Multi-stage build for the API.
#
# Migrations are deliberately NOT run on container start: they are a separate
# deploy step, so a rolling restart cannot have several instances racing to
# alter the schema while serving traffic. Run `node dist/platform/migrate-cli.js`
# as a pre-deploy job.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# --- dependencies ------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sos/api... --filter @sos/contracts --filter @sos/core

# --- build -------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @sos/contracts --filter @sos/core build \
 && pnpm --filter @sos/api build

# --- runtime -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api/migrations ./apps/api/migrations
COPY apps/api/package.json ./apps/api/

# Never run as root.
USER node
EXPOSE 4000

# The readiness endpoint checks the database and whether migrations are current,
# so an instance pointed at an un-migrated database reports itself unhealthy
# rather than serving broken requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
