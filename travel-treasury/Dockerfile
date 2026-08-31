# Travel Treasury — single-container deployment: Fastify API + built PWA.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npx vite build && npx tsc -p tsconfig.server.json

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY src/server/db/schema.sql ./dist-server/server/db/schema.sql
EXPOSE 8080
# PGLITE_DIR on a mounted volume gives a zero-dependency single-user deploy;
# set DATABASE_URL for hosted Postgres instead.
ENV PGLITE_DIR=/data/pg
VOLUME /data
CMD ["node", "dist-server/server/prod.js"]
