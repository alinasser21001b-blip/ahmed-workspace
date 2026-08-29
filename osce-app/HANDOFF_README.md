# OSCE Simulator Engineer Handoff

Prepared: 2026-08-29 (Asia/Baghdad)

## Source state

This folder is a secret-free snapshot of the current OSCE simulator working tree. It is based on Git commit `0ae43e0fac6bd326711e00aa935957632609dce4` (`Fix async upload form reset`) and includes the uncommitted direct-Cloudflare migration/hardening work present at handoff time. Git history, dependencies, build outputs, local Wrangler state, local databases, OAuth credentials, `.dev.vars`, environment files, backups, and secrets are intentionally excluded.

Use Node.js 22.13 or newer. Install dependencies with `npm ci`.

## Complete in the source snapshot

- Student OSCE flow with five specialties, random/manual examiner selection, examiner-to-case integrity, three/four-minute preparation, question flow, results, and self-scoring fallback.
- D1-backed admin knowledge ingestion, candidate review/edit/approve/reject/merge status, answer/key-point curation, publishing, and immediate student retrieval.
- Session-backed grounded evaluation and mismatch/cross-session rejection. Approved answers and key points are withheld from pre-submit student payloads.
- TXT, Markdown, DOCX, text-PDF, and bilingual PDF extraction. Page provenance is retained for text PDFs. Image-only PDFs return `OCR_REQUIRED` and create zero candidates.
- Direct Workers build configuration using vinext, Wrangler, D1 binding `DB`, R2 binding `DOCUMENTS`, static assets binding `ASSETS`, additive migrations, generated Cloudflare types, security/cache headers, safe operational logging, streaming R2 uploads, and deployment/runbook documentation.
- Production dependency audit reported zero production vulnerabilities.

Most recent validation before handoff:

- `npm run validate`: PASS (9 tests, TypeScript, ESLint).
- `npm run build:cloudflare`: PASS.
- `wrangler deploy --dry-run --strict`: PASS (about 2.4 MiB upload, about 738 KiB gzip).
- Local Workers runtime: PASS for supported uploads, R2-bound storage writes, D1 persistence, candidate review/edit/approve/reject/merge, publish/refresh, dynamic student retrieval, grounded `PARTIAL` evaluation, self-score fallback, pre-submit answer secrecy, and invalid/cross-session rejection.
- Local security headers and immutable hashed-asset caching: PASS.

## Currently deployed only on ChatGPT hosting

The existing production/rollback site remains active and was not changed during the stopped Cloudflare cutover:

- URL: https://osce-clinical-simulator.ali-nasser21001b.chatgpt.site/
- ChatGPT Sites project: `appgprj_6a92122cd4088191b28455f2f891ac89`
- Hosted source baseline in this checkout: commit `0ae43e0fac6bd326711e00aa935957632609dce4`
- Sites bindings: D1 `DB`, R2 `DOCUMENTS`

The direct-Cloudflare migration changes in this handoff have not been deployed to that ChatGPT-hosted site.

## Direct Cloudflare state and blocker

Deployment work was stopped on the user's instruction. Do not assume a Worker exists.

- Cloudflare D1 database `osce-knowledge-production` was created before the stop instruction.
- D1 migrations `0001` through `0004` were successfully applied. The non-secret database ID is already recorded in `wrangler.jsonc`.
- Cloudflare R2 was not enabled for the account. The API returned code `10042` (`Please enable R2 through the Cloudflare Dashboard`).
- The account continued to show email verification as required. A supplied verification link became invalid after use, and Cloudflare presented an anti-bot/security verification step.
- R2 bucket `osce-documents-production` was not created.
- Worker `osce-production` was not deployed; there is no direct Cloudflare public URL.
- `ADMIN_KNOWLEDGE_TOKEN` was not added to Cloudflare Workers Secrets.
- No custom domain was configured.
- Cloudflare OAuth/session credentials and all user-provided tokens are excluded from this handoff.

## Safe resume procedure

Only resume after the owner explicitly authorizes deployment again.

1. Work from a private Git repository or a new branch and preserve this snapshot unchanged.
2. Run `npm ci`, `npm run validate`, `npm run build:cloudflare`, and `npx wrangler deploy --dry-run --strict`.
3. Authenticate with `npx wrangler login`; never copy OAuth credentials into the repository.
4. In the Cloudflare dashboard, complete account email/security verification and explicitly enable R2. Review any billing screen with the owner before accepting paid terms.
5. Run `npx wrangler r2 bucket list` first. Create `osce-documents-production` only if it does not exist: `npx wrangler r2 bucket create osce-documents-production`.
6. Confirm `osce-knowledge-production` and its ID with `npx wrangler d1 list`. Run `npm run db:migrate:status`; apply only pending additive migrations with `npm run db:migrate:production`.
7. Add the admin secret interactively with `npx wrangler secret put ADMIN_KNOWLEDGE_TOKEN`. Never pass it in a URL, command argument, source file, log, or report.
8. Deploy with `npm run deploy`, capture the `workers.dev` URL, and leave the ChatGPT-hosted site untouched as rollback.
9. Repeat hosted acceptance for student flows, all upload formats, PDF provenance/OCR refusal, R2 object persistence, candidate actions, curation/publish refresh, dynamic student retrieval, grounded evaluation, self-score fallback, session security, browser console, and production API logs.
10. Attach a custom domain only if the owner supplies a Cloudflare-managed hostname and explicitly authorizes it.

## Important files

- `wrangler.jsonc`: direct Cloudflare Worker and binding configuration.
- `CLOUDFLARE.md`: operational, migration, observability, backup, deployment, and rollback runbook.
- `drizzle/`: additive D1 migrations.
- `app/api/admin/knowledge/`: admin upload/review/publish APIs.
- `app/api/knowledge/exam/route.ts`: client-safe dynamic published knowledge endpoint.
- `app/api/evaluate/route.ts` and `app/api/exam-sessions/`: grounded evaluation and session security.
- `test/knowledge.test.ts` and `test/fixtures/`: extractor/evaluation tests and upload fixtures.
- `.dev.vars.example`: placeholder-only local secret template.

## Rollback

Until a direct Worker passes hosted acceptance, continue using the existing ChatGPT-hosted URL. If a future Worker deployment fails after cutover, use `wrangler deployments list` and `wrangler rollback <known-good-version-id>`. The current D1 migrations are additive and do not require a destructive rollback.
