# Cloudflare production operations

## Architecture

`osce-production` runs the vinext application on Cloudflare Workers. Structured knowledge and exam/session state use the `DB` D1 binding. Private source documents use the `DOCUMENTS` R2 binding. `ADMIN_KNOWLEDGE_TOKEN` is a Worker secret and is never configured in `wrangler.jsonc`.

The prior ChatGPT Sites deployment remains available as a rollback target until the direct Workers deployment is fully accepted.

## Local development

Local development uses Wrangler/Miniflare-local D1 and R2 state; it does not connect to production resources unless a command explicitly includes `--remote`.

```sh
npm install
npm run db:migrate:local
npm run dev
```

Put local-only values in ignored `.dev.vars`. Never commit that file.

## Validation and build

```sh
npm run validate
npm run build:cloudflare
npx wrangler deploy --dry-run
```

`npm run deploy` is the authoritative production path. It runs tests, type checking, linting, the Workers build, production D1 migrations, and a strict Wrangler deployment.

## D1 migrations

Migration files live in `drizzle/` and are additive. Do not edit an applied migration; add a numbered migration instead.

```sh
npm run db:migrate:local
npm run db:migrate:status
npm run db:migrate:production
```

Review every pending migration before production application. Export D1 before any future migration that changes or removes existing data.

## Secrets

Configure production secrets interactively so values do not enter shell history or logs:

```sh
npx wrangler secret put ADMIN_KNOWLEDGE_TOKEN
npx wrangler secret list
```

The application fails closed with `ADMIN_AUTH_REQUIRED` when the secret is absent and never accepts the token in a URL.

## Deployment and custom domains

```sh
npm run deploy
npx wrangler deployments status
```

When the owner supplies a domain already managed in the same Cloudflare account, attach it with a Workers Custom Domain or add the confirmed domain to `wrangler.jsonc`. Do not add an unverified route or hostname.

## Cache and security policy

Content-hashed frontend assets use immutable static caching. All `/api/*` responses are `no-store`. Security headers deny framing, MIME sniffing, browser device permissions, cross-origin form submission, and external script/object sources.

Recommended account-level rate-limit rules, if abuse appears:

- `/api/admin/knowledge/*`: low per-IP burst allowance.
- `/api/exam-sessions` and `/api/evaluate`: moderate per-IP burst allowance.
- Exclude successful static asset requests.

No paid rate-limit binding is required for the Beta.

## Observability

Worker observability and invocation logs are enabled. Operational errors log only a category, error type, timestamp, and non-sensitive identifiers. Admin tokens, provider keys, source document contents, approved reference answers, and student answers must never be logged.

```sh
npx wrangler tail osce-production
```

## Backup and recovery

Create a D1 export before schema changes and on the desired backup schedule:

```sh
mkdir -p backups
npx wrangler d1 export osce-knowledge-production --remote --output backups/osce-knowledge-production.sql
```

Keep the export outside Git in protected storage. Back up the private `osce-documents-production` bucket with a scoped R2/S3 credential and an object-storage synchronization tool. Preserve object keys and metadata. D1 remains portable SQL, and source documents remain ordinary objects; no unique knowledge exists only in embeddings or an AI service.

## Daily knowledge operation

Upload → Review → Curate → Publish → Students immediately receive updated knowledge from D1 without a Worker redeployment.

## Rollback

List versions and roll the Worker back to the last known-good version:

```sh
npx wrangler deployments list
npx wrangler rollback <known-good-version-id>
```

If the direct Cloudflare candidate fails before cutover, continue using the existing ChatGPT Sites URL. D1 migrations in this release are additive, so application rollback does not require destructive database rollback.
