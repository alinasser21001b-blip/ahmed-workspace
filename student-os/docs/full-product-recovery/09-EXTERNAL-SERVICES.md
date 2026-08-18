# 09 — EXTERNAL SERVICE DEPENDENCY AUDIT

The technical companion to `10-OWNER-SERVICE-REQUEST.md`. Every dependency a
real deployment touches, what the code already expects of it, and what happens
without it. Nothing here was signed up for; no credential was invented.

The short version: **Student OS needs exactly two external services to run, and
both come with the Netlify site it already deploys to.** Everything else on this
list is either a documented gap with an honest degradation, or dead
configuration that no code reads.

---

## 1. PostgreSQL — REQUIRED, already provided

| | |
|---|---|
| CURRENT_CODE_INTERFACE | `pg.Pool` at module scope (`db.ts:34-53`), `DATABASE_URL` required by the config schema (`config.ts:18-19`); the function resolves Netlify DB's own string at boot when unset (`netlify/api/handler.mts:131-134`) |
| EXTERNAL_SERVICE_NEEDED | Netlify DB (Neon-backed) — attached to the site |
| WHY | Every read and write |
| CAN_RUN_WITHOUT_IT | No. The function answers `503 SERVICE_UNAVAILABLE` rather than guessing — the correct behaviour |
| FEATURES_BLOCKED | All of them |
| PROVIDER_OPTIONS | Netlify DB (free tier), or any Postgres via `DATABASE_URL` |
| CREDENTIAL_NEEDED | `NETLIFY_DB_URL`, created automatically when the database is enabled on the site |
| OWNER_ACTION | Enable Netlify DB on the site. Nothing else |

Known caveat, not a blocker: each warm function instance holds its own pool of
up to 10 direct connections with no external pooler, so a concurrency spike
multiplies connections against Neon's free-tier limit. Lower `DATABASE_POOL_MAX`
or use Neon's pooled string for the runtime path if that ever bites.

## 2. Object storage — REQUIRED, already provided

| | |
|---|---|
| CURRENT_CODE_INTERFACE | `StorageDriver` interface; Netlify Blobs driver registered at boot (`handler.mts:87-115`, `136-137`); production refuses the local-disk driver outright (`config.ts:115-117`) |
| EXTERNAL_SERVICE_NEEDED | Netlify Blobs — included with the site |
| WHY | Bytes for post images and lecture materials |
| CAN_RUN_WITHOUT_IT | Not in production; the refusal is deliberate, so uploads fail loudly instead of writing to a disk that vanishes |
| FEATURES_BLOCKED | Image upload, lecture materials |
| CREDENTIAL_NEEDED | None beyond the site's own environment (`STORAGE_DRIVER=external`, `MEDIA_URL_SECRET`) |
| OWNER_ACTION | None — set during deployment |

Two honest limits: uploads are **images only** (byte-sniffed; a PDF is refused
with 415), and every read passes through the function rather than a CDN.

## 3. Transactional email — MISSING, blocks password reset

| | |
|---|---|
| CURRENT_CODE_INTERFACE | `deliverPasswordResetEmail` (`platform/mailer.ts:33-39`) logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` and sends nothing. The token lifecycle around it is complete and integration-tested: 256-bit token, SHA-256 at rest, 30-minute TTL, single-use under a row lock, revokes every session on redemption |
| EXTERNAL_SERVICE_NEEDED | Any transactional email provider |
| WHY | The reset link has no way to reach the person who asked for it |
| CAN_RUN_WITHOUT_IT | The product runs; password reset does not. A student who forgets their password is locked out permanently |
| FEATURES_BLOCKED | Password reset, and only that |
| PROVIDER_OPTIONS | Resend (3k/month free), Brevo (300/day free) |
| CREDENTIAL_NEEDED | An API key and a from-address; neither exists in the config schema yet |
| OWNER_ACTION | Open a free account, hand over the key |

The code is deliberately shaped so exactly one function body changes.

## 4. A socket-capable runtime — BLOCKED BY THE CURRENT HOST

| | |
|---|---|
| CURRENT_CODE_INTERFACE | Complete on both sides: `@fastify/websocket` server with post-commit fan-out (`realtime.routes.ts:49-228`), client with jittered backoff, resubscribe and gap-replay by `seq` (`state/realtime.tsx`) |
| EXTERNAL_SERVICE_NEEDED | A host that can hold a connection open |
| WHY | `CAN_CURRENT_HOST_RUN_WS = NO`. A Netlify Function is invoked per request and answers through `app.inject()`; the upgrade at `/v1/realtime` fails every time (stated verbatim in `handler.mts:34-39`) |
| CAN_RUN_WITHOUT_IT | Yes, and it does. Messaging is HTTP-first by design: sends go through an idempotent outbox, history loads by `seq`, and both chat screens show the translated line saying live delivery is unavailable |
| FEATURES_BLOCKED | Instant delivery, typing, presence, read updates arriving unprompted |
| PROVIDER_OPTIONS | Fly.io or Render free tiers, running the existing `apps/api/Dockerfile` |
| CREDENTIAL_NEEDED | Host account; the app then needs `EXPO_PUBLIC_API_URL` pointed at it |
| OWNER_ACTION | Optional. Nothing is broken without it |

**Recovery note:** the deployed client now ships with `EXPO_PUBLIC_REALTIME=0`,
because retrying a connection the host can never accept, for the length of a
student's session, is noise pretending to be resilience. A build for a
socket-capable host simply omits the flag. Moving to a second process also needs
the Postgres `LISTEN/NOTIFY` bridge the realtime module names but does not
implement — in-memory fan-out is single-process.

## 5. Push notifications — MISSING (mostly code, not an account)

| | |
|---|---|
| CURRENT_CODE_INTERFACE | Database schema only: `notifications`, `notification_preferences`, `push_tokens` (`0006`). The only code that touches `push_tokens` deletes them on account erasure |
| EXTERNAL_SERVICE_NEEDED | Expo push (free) or FCM/APNs |
| WHY | No producer, no registration route, no client SDK |
| CAN_RUN_WITHOUT_IT | Yes; the settings screen explains the absence rather than showing a dead toggle |
| FEATURES_BLOCKED | Every notification outside the app |
| OWNER_ACTION | Schedule the work. The account is free; the code is the cost |

## 6. Monitoring, error reporting, uptime — MISSING (recommended)

| | |
|---|---|
| CURRENT_CODE_INTERFACE | Structured redacted `pino` logs to stdout, request correlation ids, and real probe targets: `GET /health` (liveness) and `GET /health/ready` (database + schema currency) |
| EXTERNAL_SERVICE_NEEDED | Uptime polling and error reporting |
| WHY | Nothing collects, aggregates or alerts. An outage is discovered by a student |
| CAN_RUN_WITHOUT_IT | Yes, unwisely |
| PROVIDER_OPTIONS | UptimeRobot (50 monitors free), Sentry (5k events/month free) |
| OWNER_ACTION | Open free accounts; wiring is configuration, not code |

## 7. Database backups — SCRIPTS WITH NOWHERE TO RUN

`ops/backup.sh` (pg_dump, checksum, retention) and `ops/restore-drill.sh` are
careful and correct, and nothing schedules them: Netlify Functions have no cron
and no shell. In the live deployment the only safety net is whatever Neon
retains on its own tier. A scheduled GitHub Actions job is the free fix. **No
restore drill has ever been evidenced.**

## 8. Custom domain / TLS — NOT NEEDED

The client is built with `EXPO_PUBLIC_API_URL=same-origin` and resolves the API
from the page's own origin, so the free `*.netlify.app` address with Netlify's
automatic certificate works with zero configuration. Two obligations exist only
on the **native** path: an EAS production build needs a stable public HTTPS API
URL, and App Store submission needs hosted support/privacy/terms pages, which
do not exist anywhere yet.

## 9. Dead configuration — no service required

- **S3 driver** (`storage.ts:67-86`): constructor throws by design. Five
  `STORAGE_*` variables are accepted by the schema and read by nothing. Only
  relevant if the API leaves Netlify.
- **AI gateway** (`config.ts:67-69`): `AI_PROVIDER` defaults to `none`, and
  nothing anywhere reads `AI_API_KEY`. No AI feature exists to block.
- **Analytics**: first-party Postgres tables (`analytics_events`,
  `learning_events`), not a vendor. Nothing external is required, and nothing
  reads them back yet.

---

## Summary

| Service | Status | Blocks | Owner action |
|---|---|---|---|
| PostgreSQL | Provided by Netlify | everything | enable it |
| Object storage | Provided by Netlify | uploads | none |
| Transactional email | **MISSING** | password reset | **free account + key** |
| Socket-capable host | Blocked by host | live delivery only | optional |
| Push notifications | MISSING | notifications | schedule the work |
| Monitoring | MISSING | nothing visible | free accounts |
| Backups scheduler | MISSING | nothing visible | schedule a job |
| Domain | Not needed | nothing | none |

**One service is genuinely required before students use this: email.**
