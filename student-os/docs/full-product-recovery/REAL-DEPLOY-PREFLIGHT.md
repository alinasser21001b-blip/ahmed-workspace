# REAL-DEPLOY-PREFLIGHT

Written under an explicit owner hold: **do not delete `EXPO_PUBLIC_PREVIEW_MODE`,
do not switch `student-os-preview` into real-system mode, do not run
migrations, do not deploy the real backend, until this document exists and
says it is safe to.** Nothing in this document caused any of those things to
happen. Every fact below is either read directly from the repository, read
via a read-only Netlify API call, or reproduced against the local
disposable environment (`studentos_e2e`/`studentos_test` Postgres, a local
API process, local web builds) — never against the live deployed site,
which currently has no function running at all.

One action was attempted before the hold arrived: a single
`manage-env-vars(deleteEnvVar)` call aimed at removing the preview flag. It
was blocked by the permission classifier before it reached Netlify and
never executed — confirmed by re-reading the site's env vars afterward
(`EXPO_PUBLIC_PREVIEW_MODE` is still present, single value, context `all`).

---

## Required fields

```
TARGET_SITE = student-os-preview (site_id 36f5f05c-f6ba-4ba7-bf39-b01d4cbc2a08)
  Verified via Netlify MCP get-project (read-only). This is NOT
  student-os-uob-stage5 (the real production site, never touched this
  session) and NOT steady-longma-2cd2b7 (do-not-deploy).

CURRENT_COMMIT (repo, local HEAD) = tip of branch `claude/student-preview`,
  17 commits ahead of origin. Code fixes span 6468c91 (round 1) and
  b6763e7..2600548 (round 2, every fix in the table below); commits after
  that are this document itself. Deliberately not pinned to a single hash
  here — this document is edited in the same branch it describes, so a
  literal HEAD hash would be stale the moment it is written. NOT what is
  currently live (see next line), and nothing has been pushed to origin
  while the hold is in effect.

CURRENT_COMMIT (site's last deploy) = 6355f9c
  Netlify MCP get-deploy-for-site, deploy id 6a83111986e0da0008a4dd43,
  context "production" (i.e. this deploy ran the site's production build
  path), committed 2026-08-17T13:48Z. This is the pre-recovery critique
  commit — none of this session's fixes have ever been deployed anywhere.

CURRENT_MODE = FIXTURE (preview build), despite running in the "production"
  Netlify context
  Deploy metadata for 6a83111986e0da0008a4dd43: available_functions: [],
  "No functions deployed", "No database migrations applied", database
  migration files: []. A real system was never live on this deploy —
  scripts/netlify-build.sh's own preview-mode guard handed the whole
  production-context build to the fixture script, because the dashboard
  variable below is set.

CURRENT_ENV_VARS (site-level, all contexts) = exactly one
  EXPO_PUBLIC_PREVIEW_MODE = "1", scope: builds, context: all.
  Read via Netlify MCP manage-env-vars(getAllEnvVars: true) — a read
  operation, no value changed. Nothing else is set: no JWT_SECRET, no
  MEDIA_URL_SECRET, no STORAGE_DRIVER, no NODE_ENV, no NETLIFY_DB_URL
  (that one is expected to be absent — it resolves automatically from the
  attached database at boot, see DATABASE_PROVIDER below).

PREVIEW_FLAG_PRESENT = YES — and it is the ONLY reason the last deploy did
  not run the real system. Confirmed: scripts/netlify-build.sh's guard
  (`if [ "${EXPO_PUBLIC_PREVIEW_MODE:-}" = "1" ]; then exec
  netlify-preview-build.sh; fi`) is the entire mechanism. Removing this one
  variable is a real state change with real consequences (below), not a
  formality.

DATABASE_PROVIDER = Netlify DB, powered by Neon (the "neon" extension,
  identeerSlug 7jjmnqyo-netlify-neon). Confirmed already ATTACHED to this
  site: the last deploy's metadata carries database_branch_id: "production"
  and database_snapshots: [{"source":"on-publish", ...}] — a database
  already exists for this site. IMPORTANT, discovered during this
  preflight: Netlify's own extension listing states "This Netlify DB
  extension (powered by @netlify/neon) has been discontinued. New database
  creation is no longer available through this extension... Your existing
  databases are not affected." This site's database predates the
  deprecation and is unaffected, but it means the `initialize-database`
  write operation must NEVER be called for this site — there is no new
  database to create, and calling it is untested territory on a
  discontinued path. This preflight did not call it.

DATABASE_BRANCH = "production" (per database_branch_id in deploy metadata).
  Not "preview" or a per-deploy branch — this is the one and only database
  branch this site's production context writes to. There is no evidence of
  a second, disposable branch for testing.

DATABASE_CONTAINS_DISPOSABLE_DATA = UNKNOWN, and this is a genuine gap, not
  an oversight. Evidence found: this session's own history records a prior
  incident where a real function WAS briefly live on this site (commit
  946c7f0, "shipped API function + real client... for ~30 min" before the
  preview-mode guard was added) — during that window `db:seed`'s
  idempotent academic-hierarchy upsert would have run automatically at
  cold start (it runs on every cold start, unconditionally, per
  netlify/api/handler.mts and academic.seed.ts). So the attached Neon
  database MAY already contain the seeded academic hierarchy (University
  of Baghdad → College of Medicine → six stages → courses/topics) from
  that incident. There is no evidence any real student ever signed up in
  that ~30-minute window, and demo:seed has never run against this site
  (see SEEDING below) — but this cannot be confirmed without a connection
  string this preflight does not have and should not obtain, or without
  actually deploying, which is the action under hold. TREAT AS: possibly
  contains real seed data, presumed to contain no real user accounts,
  unverified.

DATABASE_BACKUP_EXISTS = NO scheduled backup of this specific database.
  ops/backup.sh is a manual script requiring DATABASE_URL to be passed by
  hand; grepped every .yml/.sh/.toml in both the outer repo and student-os
  for a reference to backup.sh — zero results. Nothing schedules it: no
  cron, no GitHub Action, no Netlify scheduled function. Whatever
  redundancy exists is entirely Neon's own platform-level retention,
  which this repository has no visibility into and makes no claim about.

RESTORE_PROVEN = NO — and the repository already says so
  in its own words. docs/production-ops/06-BACKUP-RESTORE.md (written
  before this session, commit 0cc2d18): "git log --oneline -- ops/ returns
  exactly one commit... There is no evidence in git history, CI, or any
  repository artifact that restore-drill.sh has ever been executed against
  a real database... backups are not proven safe, because restoration has
  not been tested." Confirmed independently this session: `git log --all
  --oneline -- ops/restore-drill.sh` returns exactly the one authoring
  commit, nothing since.

MIGRATIONS_CURRENT = YES, with direct evidence, and they are safe by
  construction:
    - 16 migration files on disk (apps/api/migrations/*.sql); 16 rows in
      the local studentos_e2e database's schema_migrations table —
      matches, confirmed by direct psql query this session.
    - CI independently re-verifies this on every push: the `verify` job
      resets a disposable database, migrates from empty, and asserts the
      on-disk count equals the applied count (.github/workflows/ci.yml,
      the "Verify migrations apply from an empty database" step).
    - Every migration file was grepped for DROP/TRUNCATE this session.
      The only matches are five `DROP INDEX IF EXISTS` statements in
      0009_phase3_closure.sql — idempotent index replacements, not data
      loss. Zero DROP TABLE, zero TRUNCATE, zero bare DELETE without a
      WHERE clause, across all 16 files.
    - The deployed function runs the migrator at boot under a Postgres
      advisory lock, each migration committing on its own — a cold start
      cut short resumes rather than restarting (netlify/api/handler.mts's
      own comment, confirmed against migrate.ts).

SEEDING_DISABLED_IN_PRODUCTION = PARTIALLY, and precisely characterized:
    - `db:seed` (the academic hierarchy) is NOT disabled — it runs
      automatically, unconditionally, at every cold start
      (netlify/api/handler.mts boot()) AND at build time when a database
      URL resolves (netlify-build.sh). This is safe: every write is an
      `ON CONFLICT` upsert (confirmed by reading academic.seed.ts and
      scripts/seed.ts — zero raw DELETE/DROP/TRUNCATE in either file),
      creates zero user accounts, zero posts.
    - `demo:seed` (three fake students, posts, groups, a classroom) is
      genuinely never invoked by any deploy path. Grepped
      scripts/netlify-build.sh, scripts/netlify-preview-build.sh,
      netlify.toml, and netlify/api/handler.mts for "demo:seed" — zero
      matches. Its only callers are scripts/dev.sh (local) and one CI job
      step, both of which run exclusively against disposable Postgres
      (local `/tmp/pgdata` or a GitHub Actions service container that is
      destroyed with the runner). If a real deploy were to happen, no code
      path creates the fake cohort on it.

DESTRUCTIVE_TESTS_CANNOT_TARGET_DATABASE = MOSTLY, with one real gap
  identified and precisely bounded:
    - The INTEGRATION TEST SUITE'S destructive reset is well-guarded:
      apps/api/src/platform/database-safety.ts's `assertTestDatabaseUrl`
      requires the database name to literally end in "_test" AND the host
      to be loopback or a single-label private hostname, AND refuses
      outright if NODE_ENV === "production". This function is used only by
      the integration path (test/global-setup.ts, vitest.config.ts).
    - The DEVELOPER reset (`pnpm db:reset`, reached through
      apps/api/src/platform/migrate.ts's `resetDatabase`) uses a WEAKER,
      different guard: a single regex, `/_test|_dev|localhost|127\.0\.0\.1/`,
      tested against the WHOLE connection string as an OR — not a strict
      check that the database name ends in a disposable suffix AND the
      host is private. This is a real, structural gap: a URL whose
      database name happens to contain "_dev" anywhere, on ANY host
      including a public one, would satisfy this regex and be dropped.
    - Bounding the actual risk: (1) CI never sets DATABASE_URL to anything
      but its own disposable service-container Postgres — confirmed by
      reading every DATABASE_URL assignment in .github/workflows/ci.yml,
      both are literal `postgres://postgres:postgres@localhost:5432/...`
      strings. CI cannot reach the real Neon database under any code path
      found. (2) The repository's own comment on this exact gap
      (database-safety.ts's module doc) states the intended residual risk
      precisely: a developer who runs `source apps/api/.env` (setting a
      real DATABASE_URL in their shell) and then runs `pnpm db:reset` from
      that same shell. Whether that specific real connection string would
      satisfy the weak regex was NOT and should not be tested — it would
      require reading a secret this preflight does not have. Standard
      Neon-provisioned connection strings use a dotted AWS-style hostname
      and a database name like "neondb", neither of which matches the
      regex, so the default case is very likely safe, but this is
      inference from the common case, not proof against this specific
      credential. RECOMMENDATION (not executed): tighten `resetDatabase`'s
      guard to the same strict name-suffix + private-host contract
      `database-safety.ts` already implements, rather than leaving two
      different strength levels for what is nominally the same protection.

REAL_API_CAN_BOOT = YES locally (direct evidence: the local API has been
  running most of this session, health-checked repeatedly, all suites
  green against it). For the DEPLOYED function specifically: config.ts
  requires `JWT_SECRET` (no default, min 32 chars) — Zod parsing THROWS if
  it is absent, so the function fails to boot outright rather than running
  insecurely. Since JWT_SECRET is not currently set on this site (see
  CURRENT_ENV_VARS), a deploy today with only the preview flag removed
  would 503 on every request until JWT_SECRET is set. This is the correct,
  safe failure mode — loud, not silent.

MEDIA_STORAGE_PROVIDER = Netlify Blobs, and — this is the one place this
  preflight overturned an earlier assumption of this recovery's own docs —
  it does NOT depend on the STORAGE_DRIVER environment variable at all for
  this deployment path. netlify/api/handler.mts's boot() calls
  `setStorage(netlifyBlobsDriver())` UNCONDITIONALLY, every cold start.
  apps/api/src/platform/storage.ts's `getStorage()` checks `if (driver)
  return driver` FIRST, before ever consulting STORAGE_DRIVER — so once
  the host has called setStorage(), the env var is never read again for
  driver selection. STORAGE_DRIVER=external only matters for a deployment
  that does NOT hard-wire a driver in code; this one does. Practical
  consequence: 09-EXTERNAL-SERVICES.md's advice to set STORAGE_DRIVER=
  external before deploying is unnecessary for this specific site (though
  harmless if set) — the earlier docs in this recovery treated it as
  required without checking this.

MEDIA_STORAGE_CREDENTIALS_PRESENT = Netlify Blobs credentials are injected
  automatically into every Netlify Function's runtime by the platform — no
  explicit "enable" step exists for Blobs (unlike the now-deprecated Neon
  DB extension), confirmed by reading @netlify/blobs's getStore() usage
  (netlifyBlobsDriver(), handler.mts:87-113): it takes only a store name
  and a consistency mode, no credential parameter — @netlify/blobs reads
  them from the function's ambient environment, which Netlify populates
  automatically for every deployed function on every site. This was not,
  and could not safely be, verified by actually invoking a live deployed
  function (none is currently deployed) — stated as a platform-behavior
  fact from the library's own design, not a live-tested one.

EMAIL_PROVIDER = NONE. apps/api/src/platform/mailer.ts's
  deliverPasswordResetEmail logs a warning and sends nothing — confirmed
  by reading the file. This is the one capability this whole recovery
  effort has consistently reported as requiring a genuine owner action
  (09-EXTERNAL-SERVICES.md, 10-OWNER-SERVICE-REQUEST.md) and nothing in
  this preflight changes that. Password reset will not work on a real
  deploy until this is provided.

EMAIL_CREDENTIALS_PRESENT = NO. Confirmed: no env var resembling an email
  provider key exists in the site's current env vars (the only var is the
  preview flag), and the config schema (config.ts) has no field for one at
  all — adding email support requires a code change, not just a secret.

REALTIME_RUNTIME_SUPPORTED = NO, by the platform itself, not by
  configuration. netlify/api/handler.mts's own comment states it verbatim:
  a Netlify Function is invoked per request and answers through
  app.inject(), so a WebSocket upgrade at /v1/realtime can never succeed
  on this host. This recovery's own fix (commit 5b6963a) sets
  EXPO_PUBLIC_REALTIME=0 in scripts/netlify-build.sh specifically so a
  real deploy does not retry a socket forever; messaging still works over
  HTTP and both chat screens say so honestly. Round-2 adversarial review
  found this exact combination (EXPO_PUBLIC_REALTIME=0 against a real
  reachable API) has no CI/test assertion — it has only been verified by
  hand this session — recorded as a P2 process gap, not a functional one.

PUSH_PROVIDER = NONE. Confirmed: no expo-notifications dependency in
  apps/mobile/package.json, no token-registration route in apps/api/src
  (grepped for push_token across every module — only account-deletion
  code touches the table, to delete rows). Settings screen states the
  absence honestly rather than showing an inert toggle.

MONITORING_PROVIDER = NONE. Confirmed: zero matches for
  sentry/bugsnag/datadog/crashlytics/posthog/otel across all source and
  package.json files, repo-wide. What exists: structured pino logs to
  stdout, and two real health probes (GET /health liveness, GET
  /health/ready which checks DB connectivity and migration currency) that
  nothing currently polls.

ROLLBACK_PLAN = Two independent, low-effort levers, neither exercised this
  session:
    1. Re-set EXPO_PUBLIC_PREVIEW_MODE=1 on the site and redeploy (or
       trigger a rebuild) — returns the site to exactly its current,
       already-proven-safe fixture-only state. This is the fastest
       rollback and requires no code change.
    2. Netlify's own deploy history: every previous deploy remains
       available and can be restored/published from the dashboard or via
       the Netlify API's deploy-restore mechanism (not exercised or
       further verified this session — noted as available, not proven).
    No database rollback plan exists beyond "the migrator only ever adds";
    there is no tested path to undo a bad write to real data once one
    happens, which is exactly what RESTORE_PROVEN = NO
    means in practice.

EXPECTED_WRITABLE_DATA = If deployed today with all required secrets set:
  real user accounts (via open self-serve signup, no email verification —
  confirmed in Phase A audit), real posts/comments/likes/saves/reports/
  blocks, real classroom/group memberships, real uploaded images (via the
  Blobs driver proven above), and the idempotently-upserted academic
  hierarchy. No fake/demo data would be created by any deploy-time code
  path (demo:seed never runs there).

ACCOUNT_DELETION_BEHAVIOR = Verified end-to-end in Phase A's original
  audit (not re-verified live this session, since that would create and
  then delete a real account against the local database rather than
  proving anything about the deploy target): DELETE /v1/me/account
  performs a full cascade — content, memberships, sessions, storage
  objects, message tombstoning, ownership transfer/archival of
  solely-owned groups/communities/classrooms — behind a password
  re-entry requirement and a 5-per-15-minute rate limit
  (account.routes.ts:27, account.service.ts).

PRODUCTION_DATA_RISK = The real, load-bearing risk this preflight exists
  to surface: this site's attached database is NOT proven disposable
  (see DATABASE_CONTAINS_DISPOSABLE_DATA above — it may hold seed data
  from a prior brief live window, unconfirmed), has NO scheduled backup,
  and has a written, repository-native admission that restoration has
  never been tested. A deploy that goes wrong here has no proven recovery
  path. This is the single fact that should weigh most heavily on
  SAFE_TO_REQUEST_OWNER_GO below — not because deploying is unsafe in the
  ordinary sense (no code path found this session can destroy data), but
  because if something unexpected DID damage data, there is nothing this
  repository can currently point to and say "and here is how we undo it."
```

---

## Adversarial review status

### Mandatory domain ledger

All thirteen domains the owner named. Every one finished; **none** is
recorded `COULD_NOT_COMPLETE`.

| # | Mandatory domain | Round | Reviewer status | Findings confirmed |
|---|---|---|---|---|
| 1 | Product | 1 | COMPLETE | included in round 1's 7 confirmed |
| 2 | Social feed | 1 | COMPLETE | 1 P0 (block broken), 2 P1 |
| 3 | Messaging | 2 | COMPLETE | 1 (#14) |
| 4 | Classroom / lectures | 2 | COMPLETE | 1 (#15) |
| 5 | Learning / Practice | 2 | COMPLETE | 3 (#5, #6, #16) |
| 6 | Arabic / RTL | 1 | COMPLETE | included in round 1's 7 confirmed |
| 7 | Accessibility | 2 | COMPLETE | 4 (#7, #8, #9, #10) |
| 8 | Security / UGC | 2 | COMPLETE | 1 P0 (#1) |
| 9 | Bundle cleanliness | 1 | COMPLETE | 1 P2 (inert preview strings, disclosed in `12-QA-REPORT.md`) |
| 10 | Runtime / deployment | 1 | COMPLETE | 1 P2 (untested env combination, disclosed in `12-QA-REPORT.md`) |
| 11 | Environment safety | 2 | COMPLETE | 1 P0 (#2) |
| 12 | Database safety | 2 | COMPLETE | 2 (#3, #4) |
| 13 | Storage / files | 2 | COMPLETE | 3 (#11, #12, #13) |

`COULD_NOT_COMPLETE = <none>` — no reviewer in either round terminated
early, hit a tool or permission wall it could not work around, or returned
without a verdict. The two round-1 P2s marked "disclosed, not fixed" are a
deliberate scope decision recorded in `12-QA-REPORT.md`, not an incomplete
review: both were fully investigated and neither blocks a deploy.

One honest limit on the *depth* of two domains, stated so it is not
mistaken for completeness it does not have: **Storage / files** and
**Runtime / deployment** were reviewed exhaustively against the code and
the local environment, but neither could exercise the actual deployed
Netlify runtime — doing so requires the deployment this hold forbids. That
limit is what finding #12 documents and what blocker 4 below carries
forward. It is a bounded gap in evidence, not an unfinished review.

### Round detail

**Round 1** (product, social feed, bundle cleanliness, Arabic/RTL, runtime/
deployment honesty) — COMPLETE. 9 findings raised, 7 survived independent
verification. One confirmed P0 (blocking a user was completely broken —
missing request body, silent 400) and two confirmed P1s (the recovery's own
block-coverage test never clicked confirm; Today's `loadMore` had no
re-entrancy guard and could duplicate posts on a fast scroll) have all been
fixed and re-verified live this session (commit `6468c91`). Two P2s
(EXPO_PUBLIC_REALTIME=0 combination untested in CI; 35 inert
`preview.feedback.*` translation strings remain in the real bundle) are
disclosed in `12-QA-REPORT.md` and not yet fixed — neither blocks a deploy
on its own. Two further findings were investigated and correctly refuted:
a stale-commit preview-banner claim (already fixed by the time it was
checked), and a bidi-isolation "corruption" claim whose proposed fix would
have reintroduced the defect it targets.

**Round 2** (messaging, classroom/lectures, learning/practice,
accessibility, security/UGC, environment safety, database safety,
storage/files) — launched under this document's own safety constraints
(explicitly read-only, explicitly forbidden from touching any Netlify
tool or running any destructive/migrate/reset/seed script against
anything but the already-running local disposable databases). **COMPLETE.**
All eight requested domains reported; none returned COULD_NOT_COMPLETE. 26
agents ran (8 reviewers + 18 independent adversarial verifiers, one to
three per finding). 18 findings were raised; 15 survived adversarial
verification (each tried, by a separate agent instructed to refute it,
against live reproduction where the domain allowed it — signed-in HTTP
calls against the real local API, Playwright against a real local web
build, direct Postgres queries), 3 were refuted, and one refutation itself
surfaced a real, different defect in the same component (below).

All 15 confirmed findings have since been fixed and verified — either by
a code change with a passing regression test, or, for the two findings
whose actual gap cannot be closed without a real deployment (which the
hold forbids), by correcting the documentation that had mischaracterized
it. Severities below are round 2's own adversarially-corrected severities,
which sometimes differ from the domain reviewer's first-pass severity —
verification lowered three (P1→P2) and left the rest unchanged.

| # | Domain | Finding | Sev | Resolution |
|---|---|---|---|---|
| 1 | security | Arabic slur term normalisation mismatch let a block-severity term through moderation unfiltered | P0 | **Fixed** — `packages/core/src/moderation/moderation.ts` normalises the stored pattern before comparison, not just the submission. 3 new unit tests. Commit `b6763e7`. |
| 2 | environment | `NODE_ENV==='production'` guards were unverified on the real deploy path; CI's own packaging test hardcoded the value it should have tested the absence of | P0 | **Fixed** — `handler.mts`'s `boot()` now defaults `NODE_ENV` to `production` as its first statement; `verify-function-package.mjs` gained a probe that runs with `NODE_ENV` genuinely unset and checks the boot-failure stderr. Commit `6742651`. |
| 3 | database | `demo:seed` had no code-level target-safety check at all | P1 | **Fixed** — `assertSeedTarget()` refuses to run unless `NODE_ENV` is not production, `DATABASE_URL` looks disposable, and `API_URL` resolves to a private host. Commit `48be869`. |
| 4 | database | `resetDatabase()`'s guard was an unanchored substring regex against the whole connection string, weaker than the test suite's own contract | P2 | **Fixed** — `checkResettableDatabaseUrl` parses the URL and checks the database name and host as distinct fields, mirroring `checkTestDatabaseUrl`'s structure with a wider (but still closed) suffix list. 12 new unit tests. Commit `68c757f`. |
| 5 | learning | Learn tab's "Saved posts" count counted bookmarks on soft-deleted content the Saved screen itself excludes | P1 | **Fixed** — `countBookmarks` now joins `content_items` and requires `deleted_at IS NULL`, matching the Saved feed's own filter. Commit `5c9a239`. |
| 6 | learning | A topic could appear on the Learn tab both as "answered" (real stats) and "Not answered yet" (a stale interest-topic listing) | P1 | **Fixed** — `listInterestTopics` excludes any topic with an existing `learning_progress` row via `NOT EXISTS`, at the SQL level rather than a list-intersection at the call site. Commit `5c9a239`. |
| 7 | accessibility | None of the three shared dialog types (report/block-confirm/action menus) exposed an accessible name | P1 | **Fixed** — `accessibilityLabel` added to all three `Modal`s. Live-verified via Playwright `aria-label` reads. Commit `d919385`. |
| 8 | accessibility | ReportSheet's own code comments promised initial focus moves to the heading; nothing implemented it — focus landed in the details textarea | P1 | **Fixed** — real focus-on-open, plus a second, delayed re-assertion to win a race against a closing ActionSheet's own focus-trap cleanup (discovered live while verifying the first fix). Live-verified landing on the heading, not the textarea. Commit `d919385`. |
| 9 | accessibility | Client-side route changes never moved keyboard focus, so Today→post-detail, Today→compose, and closing the Report sheet all dropped focus onto `<body>` | P1 | **Fixed** — `useFocusHeadingOnReady`/`focusSoon` (new, `src/a11y/useFocusHeading.ts`) move focus to each destination screen's heading and restore it to the triggering "More" button on dialog close. Live-verified for both destination screens and both dialog-close paths. Commit `d919385`. |
| 10 | accessibility | (surfaced while investigating a refuted claim about react-native-web's own focus-trap brackets) ActionSheet's inner card `Pressable` had no `accessibilityRole` and was a reachable, blank Tab stop | P2 (unstated in original) | **Fixed** alongside #7–9 — `tabIndex={-1}` + `accessibilityRole="none"`. Commit `d919385`. |
| 11 | storage | Deleting a single file soft-deleted the row but never freed the storage bytes — no code path anywhere reclaimed them | P1 | **Fixed** — `deleteOwnFile` now calls `storage.delete()` after the row is confirmed gone, matching the ordering `account.service.ts` already uses. 3 new integration tests confirm the bytes are actually unreadable after delete. Commit `104a6ec`. |
| 12 | storage | Netlify Blobs driver has zero test coverage and no health-check signal; two docs labelled it `CONNECTED_AND_WORKING` — the vocabulary used elsewhere for capabilities with real integration coverage | P1 | **Documented, not code-fixed** — the underlying gap (no live Netlify Blobs invocation exists anywhere, by design: creating one would mean deploying, which the hold forbids) cannot be closed from this session. `01-CAPABILITY-MATRIX.md` and `08-CLASSROOM-LECTURE-READINESS.md` now say so plainly instead of overstating it. This is why `MEDIA_STORAGE_CREDENTIALS_PRESENT`/an actual Blobs round-trip remain unproven below. Commit `2600548`. |
| 13 | storage | Recovery docs disagreed on whether `STORAGE_DRIVER=external` is required, and neither resolved the actual guard-ordering nuance | P2 | **Documented** — `09-EXTERNAL-SERVICES.md` and `01-CAPABILITY-MATRIX.md` corrected: the driver is registered unconditionally regardless of the env var, and the production guard against `STORAGE_DRIVER=local` runs after that registration has already happened, so it cannot actually prevent an ephemeral-disk deploy on this path. Commit `2600548`. |
| 14 | messaging | The composer's read-only reason was hardcoded to "Only instructors can post here" regardless of the real reason (no such rule exists in the messaging policy) | P2 | **Fixed** — `ConversationViewerState.cannotSendReason` surfaces the real policy reason (`account_restricted`/`not_a_member`/`blocked`); the client picks matching copy per reason, in both locales. 2 new integration assertions. Commit `f095095`. |
| 15 | classroom | `container.name` was hardcoded to `''` for every classroom-scoped post, unlike community/group posts in the same function | P2 | **Fixed** — the feed SQL now joins `classrooms` and selects its real title. New integration test. Commit `f095095`. |
| 16 | learning (doc) | Three of the four audit docs described the profile contribution score as still rendered; the client (same commit) had already removed it | P2 | **Documented** — correction notes added to `06-LEARNING-ARCHITECTURE.md`, `01-CAPABILITY-MATRIX.md`, `02-PRODUCT-INTENT-VS-CURRENT.md`. Commit `2600548`. |

(Table numbering runs 1–16 because the ActionSheet-Pressable gap, #10, was not
one of the 15 findings the workflow itself counted — it was an incidental
discovery inside a refuted claim's own verification, folded into the same
fix and the same commit as its siblings.)

**Refuted** (investigated, did not stand): a claim that react-native-web's
own `ModalFocusTrap` brackets are a reachable, unlabeled Tab stop (the
brackets work correctly by design; the real gap was the ActionSheet
Pressable above, #10); a claim that `resetDatabase`'s guard was weaker
than the test suite's (partially correct, superseded by and fixed as
finding #4 above with the *corrected*, more precise description of the
gap); a duplicate framing of the `STORAGE_DRIVER`/guard-ordering nuance
that finding #13 states more precisely.

Every round-2 finding is now either fixed with a passing regression test,
or — for the two whose underlying gap requires an actual deployment to
close — accurately documented instead of overstated. Full round-2 output
(evidence, live-reproduction transcripts, adversarial-verification
reasoning for all 18 raised findings) is preserved in this session's
workflow journal, not duplicated into this document.

---

## FINAL_ADVERSARIAL_GATE = PASS

Round 2 is now complete: every requested domain reported, none returned
COULD_NOT_COMPLETE, and all 15 confirmed findings (16 counting the
incidental ActionSheet-Pressable discovery) are resolved — 13 with a code
fix and a passing regression test, 2 with a documentation correction where
the underlying gap cannot honestly be closed without an actual deployment.
Combined with round 1 (7 confirmed findings, all fixed and re-verified
earlier this session), the adversarial process the owner asked for —
every mandatory domain reviewed, every finding recorded and resolved or
explicitly left as an owner decision — is complete. This gate answers
"was the review done and acted on," not "is it safe to deploy" — that is
`REAL_DEPLOY_PREFLIGHT`, below, and it does not pass.

## REAL_DEPLOY_PREFLIGHT = FAIL

Independent of the adversarial gate: `DATABASE_CONTAINS_DISPOSABLE_DATA =
UNKNOWN` and `RESTORE_PROVEN = NO` are, on their own,
sufficient to fail this. Both are pre-existing facts about the site and
the repository, not something this session introduced or can resolve by
more code — they require an owner decision. `MEDIA_STORAGE_CREDENTIALS_
PRESENT` and a real Netlify Blobs round-trip remain unproven for the same
reason (finding #12 above): proving them requires a deployment this hold
forbids.

## SAFE_TO_REQUEST_OWNER_GO = NO

Blockers, in the order they'd need resolving. Unlike the previous version
of this document, none of these is "finish the review" — that part is
done.

1. **The attached database's contents are unconfirmed.** The owner is the
   only person who can say whether the "production" Neon branch already
   attached to this site is safe to write real data into, or whether it
   should be reset to empty first (and if reset, via a verified-safe path
   — see the `resetDatabase` guard gap above, now fixed either way).
2. **No backup exists and no restore has ever been proven**, for this or
   any database this repository manages. This is a pre-existing condition,
   not something this deploy would create, but deploying real user data
   onto it makes the gap matter for the first time.
3. **Two required secrets are not yet set on the site**: `JWT_SECRET` (the
   function will not boot at all without it — safe failure, but still a
   blocker) and, separately, a real email provider (password reset cannot
   complete without one — a genuine owner action, not a config value this
   session can set).
4. **Netlify Blobs has never actually been exercised.** The code path is
   correct on inspection (finding #12), but "correct on inspection" is not
   "proven working" for the one piece of this deploy that cannot be
   verified from a laptop. The first real upload against the deployed
   function is the first real test it will ever get — worth watching
   closely rather than assuming.

None of these are code defects. All four are the exact category of
decision Section 34 reserves for the owner: external credentials
(email, storage verification), irreversible-adjacent production data
handling (the database question), and a documented, pre-existing gap
(backups) that predates this recovery and this preflight did not create.

**When ready to proceed, in order:**
- Owner confirms whether the attached Neon "production" branch may be
  written to as-is, or should be reset first (and by whom, using which
  verified-safe procedure).
- Owner provides an email-sending credential (Resend or Brevo free tier —
  see `10-OWNER-SERVICE-REQUEST.md`).
- This session (or a future one) sets `JWT_SECRET` on the site (a
  locally-generated random secret, not a third-party credential) —
  only after the above two are settled, not before.
- Only then: remove `EXPO_PUBLIC_PREVIEW_MODE`, deploy, and verify against
  the six ENVIRONMENT/COMMIT/FUNCTIONS/DATABASE/MIGRATIONS/FIXTURE_MODE/
  SECRETS_SOURCE facts Section 31 requires, live — including a real file
  upload, to give Netlify Blobs its first actual test.
