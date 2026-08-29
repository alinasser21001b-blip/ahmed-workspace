# To the Next Software Engineer

Start with `HANDOFF_README.md`, then use this page as the execution summary.

## What is complete

The OSCE simulator source includes the student exam experience, five specialties, random/manual examiner flows, examiner-case integrity, timed preparation, question/results flows, self-scoring fallback, D1-backed knowledge administration, document extraction, candidate review/curation/publishing, immediate student retrieval, grounded evaluation, and session security.

The direct-Cloudflare source migration is implemented: vinext/Workers build, Wrangler configuration, D1/R2/assets bindings, additive migrations, generated types, streaming private uploads, security/cache headers, safe operational logging, tests, fixtures, and operations documentation.

Latest completed checks:

- Tests, TypeScript, and ESLint: PASS.
- Workers production build and strict deployment dry-run: PASS.
- Local Workers runtime: PASS for TXT/Markdown/DOCX/text-PDF/bilingual-PDF uploads, PDF provenance, scanned-PDF `OCR_REQUIRED` with zero candidates, review/edit/approve/reject/merge, publish persistence, dynamic student retrieval, grounded `PARTIAL` scoring, self-score fallback, answer secrecy, and invalid/cross-session rejection.
- Security headers and immutable hashed-asset caching: PASS.

## Deployment was intentionally stopped

The owner explicitly stopped the direct Cloudflare cutover. Do not provision or deploy anything until the owner explicitly authorizes resumption. The existing ChatGPT-hosted application remains the production/rollback site and was left unchanged:

https://osce-clinical-simulator.ali-nasser21001b.chatgpt.site/

## Current Cloudflare state

- Existing: D1 database `osce-knowledge-production`; migrations `0001`–`0004` were applied.
- Not existing: R2 bucket `osce-documents-production`.
- Not existing: deployed Worker `osce-production` or direct Cloudflare public URL.
- Not configured: production `ADMIN_KNOWLEDGE_TOKEN` Worker secret.
- Not configured: custom domain.

The account blocker is Cloudflare account email/security verification. R2 remained disabled and its API returned code `10042`. A verification attempt reached Cloudflare's security/anti-bot gate. No credentials, OAuth state, verification token, admin token, or environment file is included here.

## Prioritized next mission

1. Obtain explicit owner authorization to resume deployment.
2. Preserve this package, create a private repository/branch, run `npm ci`, `npm run validate`, `npm run build:cloudflare`, and the strict Wrangler dry-run.
3. Have the owner complete Cloudflare account email/security verification. Enable R2 only after reviewing any billing terms with the owner.
4. List resources first. Create `osce-documents-production` only if absent; confirm the existing D1 name/ID and migration status without recreating it.
5. Add `ADMIN_KNOWLEDGE_TOKEN` interactively as a Worker secret. Never place it in source, URLs, command arguments, logs, or reports.
6. Deploy `osce-production`, capture its `workers.dev` URL, and keep the ChatGPT-hosted site untouched as rollback.
7. Repeat the complete hosted acceptance suite, including real R2 persistence, all admin actions, dynamic publish-to-student behavior, PDF/OCR behavior, grounded evaluation, self-score fallback, session isolation, browser console, and production API logs.
8. Attach a custom domain only if the owner supplies a Cloudflare-managed hostname and explicitly authorizes the change.

If any resource or account state differs from this brief, stop and reconcile it with read-only Cloudflare listings before making changes.
