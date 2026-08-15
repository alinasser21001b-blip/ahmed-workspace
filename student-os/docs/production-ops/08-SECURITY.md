# 08 — Security

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§9 Security**: secret management, production logging, PII leakage, storage access, signed URLs, database public exposure, admin authorization, backup access.

## 1. Confirmed secure by design

Stated first, because the security posture here is better than the gap list in §2 alone would suggest, and because each item is evidence, not assertion:

- **Pino redaction** (`logger.ts:12-26`) scrubs `password`, `passwordHash`, `refreshToken`, `accessToken`, `token_hash`, `AI_API_KEY`, `JWT_SECRET`, and auth headers/cookies from every log line, centrally.
- **A hardened, regression-tested boot-failure envelope** (`handler.mts:217-264`), built in response to a real incident that leaked a `/var/task` path, a stack frame, and a connection string. `verify-function-package.mjs` boots the *packaged* function with a fake password (`hunter2`) and asserts it never appears in the public response — a leak probe that runs in CI on every change.
- **`canAccessFile` as a single, consistently applied policy gate**, called before any signed URL is minted.
- **Signed URLs**: HMAC-SHA256 over `fileId:expiresAtSeconds`, `timingSafeEqual` constant-time comparison, and a **boolean-only verification result** — no oracle distinguishing "expired" from "bad signature."
- **UUID storage keys**, not sequential, sharded by owner and date. Path-traversal guarding on the local driver.
- **A single `isPlatformAdmin` definition**, gated at the service layer — a deliberate choice over a route hook, per the module's own comment, to avoid *"two places that decide who is an administrator [that] can disagree."*
- **Backup scripts never persist or log the connection string**; dump artifacts are gitignored; `restore.sh` refuses a non-scratch target without an explicit opt-in.
- **Config fails fast** (`config.ts:12-85`): `JWT_SECRET` requires `min(32)` with explicitly no fallback (*"a hardcoded fallback secret is the single most common way a deployment ships with forgeable tokens"*); `MEDIA_URL_SECRET` is required in production; `STORAGE_DRIVER=local` throws in production.

**No hardcoded or logged secrets were found anywhere in the repository.**

## 2. Production logging and PII

**No PII-leakage gap was found in the logging code itself.** Logs are structured JSON in production, redaction is configured centrally rather than per-call-site, and the per-request access line carries `actorId` — an opaque identifier — rather than email, name, or any direct identity field.

**The residual risk is downstream, not in this code.** Logs currently go to stdout and are retained by whatever the platform does with function logs; the practical PII exposure surface is bounded by Netlify's retention rather than by application behavior (`NEEDS LIVE VERIFICATION` for what that retention actually is).

This becomes a live constraint the moment `05-MONITORING.md`'s P0 log-shipping lands: **the application's redaction guarantees cover only what the application logs.** A log platform configured to capture raw request bodies or headers at the ingestion layer would reintroduce exactly the PII the redaction list removes. Verify what the destination captures, not just what the app emits.

## 3. Storage access and signed URLs

**No cryptographic weakness identified** — see §1.

The gap in `04-MEDIA-CDN.md` (API-proxied reads, `cache-control: private`) is a **cost and latency issue, not a security weakness**. If anything, funnelling every read through the function is a *more* tightly controlled access pattern than a CDN redirect would be.

**This is the one place where a performance recommendation could regress security, so it is recorded explicitly**: moving media to CDN-fronted delivery must preserve signature verification at the edge. Relaxing `cache-control: private` without relocating the authorization check would make every media object publicly cacheable by shared caches — a straight downgrade from the current posture. Whether Netlify's CDN can verify signatures at the edge for a private Blobs store is `NEEDS LIVE VERIFICATION`; if it cannot, the correct answer is to keep the proxy, not to drop the check.

## 4. Database exposure and connection security

**Confirmed gap: `DATABASE_URL` is validated only as `min(1)`.** No SSL enforcement, no host restriction, no rejection of an unexpected target. This stands in pointed contrast to the guards that *do* exist in the same file for `STORAGE_DRIVER` and `MEDIA_URL_SECRET` — the fail-fast pattern is established and simply was not applied here.

`RECOMMENDED`: extend the existing Zod schema to require SSL in production. Config-only, consistent with the guards already present.

`NEEDS LIVE VERIFICATION` (this is a documentation audit, not a live penetration test, and per the brief no production infrastructure was probed):

- Whether the live `DATABASE_URL` actually enforces SSL.
- Whether the Neon-backed Netlify DB instance is reachable publicly without credentials. Netlify DB is a managed product rather than a self-provisioned instance, so the platform's defaults are the relevant control — worth an explicit one-time check rather than an assumption.

## 5. CI security posture — one finding corrected

**CI exists.** An earlier pass of this audit, scoped only to the `student-os/` subdirectory, reported that no `.github/workflows/` directory existed anywhere and that there was no CI pipeline at all. **That finding was wrong and is retracted here.**

`.github/workflows/ci.yml` lives at the **outer repository root**, one level above `student-os/`, with `defaults.run.working-directory: student-os` — which is precisely why a subdirectory-scoped search missed it. The file's own header explains that this location is mandatory: a workflow nested inside a project directory is never registered by GitHub Actions, and an earlier nested version meant *"Phases 0 through 5 all merged without CI."*

CI is genuinely thorough: typecheck (including the Netlify function's own tsconfig), lint, unit tests, integration tests, a migrations-from-empty assertion, the **deployment-contract gate** (packages the function with Netlify's real bundler, imports it from a directory with no access to `node_modules`, drives live HTTP against it, and asserts a failed boot leaks nothing), plus a full E2E `journey` job.

**The corrected, narrower finding stands:**

- **No dependency-vulnerability scanning** — no `pnpm audit` step, no Dependabot configuration, no Snyk.
- **No general secret scanning.** The only related check is `scripts/appstore-check.mjs`'s grep for three demo-credential patterns, and it is scoped **only to `apps/mobile/app` and `apps/mobile/src`** — the mobile bundle. `apps/api` is not covered.

Both are `RECOMMENDED` additions to the existing `verify` job — configuration on a pipeline that already exists, not new infrastructure. Note the complementarity with §1: `config.ts` guards against a secret being *missing at runtime*; nothing currently guards against one being *committed to source*.

## 6. Admin authorization

The mechanism is sound (§1, `07-ADMIN-CONTROL-PLANE.md` §1). Two gaps, one structural and one operational:

**Structural**: enforcement is **convention, not constraint**. Every admin service function calls `assertMayAdminister` first, but nothing prevents a future one from omitting it — no lint rule, no type-level requirement, no test asserting universal coverage. `RECOMMENDED`: a test that enumerates admin service exports and asserts each rejects a non-admin actor. Cheap, and it converts a convention into a checked invariant.

**Operational, and the more serious of the two**: because **no admin UI exists at all** (`07-ADMIN-CONTROL-PLANE.md` §3), the realistic path for an urgent admin action is direct database access — which bypasses the service-layer authorization **and** the audit logging entirely. An admin action taken via SQL leaves no `audit_log` row, no `moderation_actions` row, and no attribution.

**Building the admin console is therefore a security recommendation, not only a usability one.** It channels admin actions back through the authorized, audited path instead of around it. This is compounded by the audit trail's own incompleteness: `audit_log` has exactly two writers and one narrow reader, and moderation actions and admin content deletions are not written to it at all.

## 7. Backup access

`ops/` scripts handle credentials well within their own boundaries (§1). What this audit **did not** verify — and per its documentation-only constraint did not attempt to verify against production:

- **Who or what can execute the backup and restore scripts**, and with what credentials.
- **Where backup artifacts are stored, and with what access control.** A backup is by definition a complete copy of the production database, including private messages and student records. The common real-world failure is treating backup storage as an afterthought with looser access control than the live database it copies.
- **Whether credentials used by these scripts are scoped and rotated.**

All `NEEDS LIVE VERIFICATION`. The natural moment to do it is while running the P0 restore drill (`06-BACKUP-RESTORE.md` §3) — the same exercise that proves restoration works is when someone is already handling the artifacts and credentials in question. Note also §4 of that document: **there are no off-host copies**, so backup artifacts currently share a failure domain with the thing they protect.

## 8. Summary

| Area | Status | Priority |
|---|---|---|
| Secret management at runtime (fail-fast config) | `EXISTS_NOW` | — |
| Log redaction, correlation, no PII in access logs | `EXISTS_NOW` | — |
| Boot-failure leak hardening + CI leak probe | `EXISTS_NOW` | — |
| Signed URLs (HMAC-SHA256, constant-time, non-oracle) | `EXISTS_NOW` | — |
| CI dependency-vulnerability scanning | **missing** (CI itself exists) | **P0** |
| CI secret scanning (existing grep is mobile-only) | **missing** | **P0** |
| `DATABASE_URL` SSL/host validation | **missing** — inconsistent with sibling guards | P1 |
| Admin authorization enforced structurally, not by convention | `PARTIALLY_EXISTS` | P1 |
| Admin actions bypass audit trail without a console | operational risk | tied to `07-ADMIN-CONTROL-PLANE.md` P0 |
| Log-shipping destination must not re-capture PII | constraint on `05-MONITORING.md` P0 | P0 constraint |
| CDN migration must preserve edge signature verification | constraint on `04-MEDIA-CDN.md` P0 | P0 constraint |
| Live DB public exposure / SSL enforcement | — | `NEEDS LIVE VERIFICATION` |
| Backup artifact access control and off-host copies | — | `NEEDS LIVE VERIFICATION`, pair with the P0 drill |
| Netlify Sensitive Variable Policy enabled | — | `NEEDS LIVE VERIFICATION` |
| Netlify Blobs store private by default | — | `NEEDS LIVE VERIFICATION` |
| Live `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` values | — | `NEEDS LIVE VERIFICATION` |
| Rate limiter is per-instance, not global | `EXISTS_NOW` (as a gap) | P1 — `01-TARGET-ARCHITECTURE.md` §4 |
