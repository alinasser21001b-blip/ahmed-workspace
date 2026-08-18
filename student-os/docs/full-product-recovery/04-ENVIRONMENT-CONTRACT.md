# 04 — ENVIRONMENT CONTRACT

Four environments, and exactly what each one is allowed to be. The rule that
governs the whole table: **a staging or production student build must never
silently fall back to fixtures.** The audit confirmed no such path exists, and
this document is what keeps it that way.

Everything below is keyed to build-time constants, because a runtime switch is
a switch somebody can flip by accident.

---

## The switches

| Variable | Read at | Values | Effect | Fails |
|---|---|---|---|---|
| `EXPO_PUBLIC_PREVIEW_MODE` | export time, inlined (`src/preview/preview-mode.ts:40-48`) | `1` / `true` only | Serves the in-memory fixture world instead of the network | **Closed** — unset means false; no hostname inference, not flippable at runtime |
| `EXPO_PUBLIC_REALTIME` | export time (`src/state/realtime.tsx`) | `0` disables | Stops the client attempting a WebSocket the host cannot hold | **Open** — unset means realtime ON; only a host known to be incapable turns it off |
| `EXPO_PUBLIC_API_URL` | export time, gate-checked (`scripts/check-api-url.ts`) | URL or `same-origin` | Which API the client talks to | Build refuses without it |
| `NETLIFY_DB_URL` (or `DATABASE_URL`) | build + function boot | connection string | Migrations, seed, and every query | Function returns `503 SERVICE_UNAVAILABLE` rather than guessing |
| `JWT_SECRET` | function boot | ≥32 chars | Session signing | Boot refuses in production |
| `STORAGE_DRIVER` | function boot | `external` in production | Netlify Blobs for uploaded bytes | Production boot refuses `local` |
| `MEDIA_URL_SECRET` | function boot | secret | Signs media URLs | Mandatory in production |

The two `EXPO_PUBLIC_*` values are the only ones that reach the client bundle,
and `scripts/appstore-check.mjs` greps the export to assert that no
`EXPO_PUBLIC_*` name looks like a secret.

---

## TEST

Local and CI. Nothing here is reachable by a student.

| | |
|---|---|
| **API** | Fastify in-process (`app.inject`) or on `localhost:4000` |
| **DB** | `studentos_test`, disposable. The suite **refuses to run** if `DATABASE_URL` points anywhere else (`test/global-setup.ts:68`) — a guard that fired during this recovery and was correct to |
| **FILES** | Local disk driver, path-traversal guarded; permitted only outside production |
| **EMAIL** | None. The mailer stub logs and drops |
| **PUSH** | None |
| **REALTIME** | Real WebSocket server — this is the only environment where realtime is genuinely exercised |
| **FIXTURES** | Not used; tests speak to the real API |
| **DEBUG UI** | Preview routes available when built with the flag |
| **SECRETS** | Throwaway values in the test harness |
| **ALLOWED DATA** | Synthetic only. `demo:seed` accounts (@amjad, @zainab, @omar, shared password) live here and nowhere else |

## PREVIEW

The fixture-only student preview: a design review artifact, deliberately unable
to reach a backend.

| | |
|---|---|
| **API** | **None.** No function is deployed (`netlify/no-functions/`), and the client's transport is the in-memory fixture world |
| **DB** | None. No connection string is ever resolved |
| **FILES** | Fixture references only; no upload path |
| **EMAIL / PUSH** | None |
| **REALTIME** | Socket never constructed (`realtime.tsx` returns early); the honest "live delivery unavailable" line still shows |
| **FIXTURES** | **Yes — the point of this build.** `EXPO_PUBLIC_PREVIEW_MODE=1` |
| **DEBUG UI** | Preview banner and the feedback form, both gated on the same flag |
| **SECRETS** | None needed, none present |
| **ALLOWED DATA** | Invented people and invented posts, and nothing else. No student writes anything that survives a reload |

Built by `scripts/netlify-preview-build.sh`, which **refuses to run** without the
flag. Netlify's `deploy-preview` and `branch-deploy` contexts set it in
`netlify.toml`; the dedicated preview site sets it as a site variable.

## STAGING

A real system with real code paths, on data nobody depends on. This is where the
recovery deploys for owner review.

| | |
|---|---|
| **API** | The bundled Fastify function, same origin as the client |
| **DB** | The site's own Netlify DB (Neon). Migrations run at build when the URL resolves, otherwise at first cold start under an advisory lock |
| **FILES** | Netlify Blobs (`STORAGE_DRIVER=external`), signed URLs |
| **EMAIL** | **Missing** — password reset cannot complete (see 09/10) |
| **PUSH** | Missing (schema only) |
| **REALTIME** | **Off by build flag.** The host cannot hold a socket; messaging works over HTTP and says so |
| **FIXTURES** | **Never.** The flag is unset, so the fixture modules are not even in the bundle |
| **DEBUG UI** | None. No banner, no feedback form, no motion samples, no test routes |
| **SECRETS** | Netlify environment variables, set on the site, never in the repository |
| **ALLOWED DATA** | Real accounts created by whoever is reviewing, plus the seeded academic hierarchy. **No demo cohort** — `demo:seed` is never invoked by any Netlify build |

## PRODUCTION

Identical to staging in every code path — the difference is who is on it and
what the data is worth.

| | |
|---|---|
| **API / DB / FILES** | As staging, with its own database and its own secrets |
| **EMAIL** | Required before launch: without it, a student who forgets their password is locked out permanently |
| **PUSH** | Absent, and honestly absent — the settings screen explains rather than showing a dead toggle |
| **REALTIME** | Off until the API runs somewhere that can hold a socket |
| **FIXTURES / DEBUG UI** | Never, under any circumstance |
| **SECRETS** | Production-only values; nothing shared with staging |
| **ALLOWED DATA** | Real student data, under the account-deletion and moderation guarantees in 03-UGC-SAFETY-MATRIX.md |

---

## What keeps these apart

1. **One flag, one meaning.** Preview is preview because it was *exported* with
   the flag. There is no second definition — no hostname check, no URL
   parameter, no localStorage key.
2. **Absence, not just inertness.** Since this recovery, a non-preview build
   does not contain the fixture world at all: `metro.config.js` resolves the
   preview modules to a stub that throws. Unreachable code was still shipped
   code, and a student's device downloaded a cast of invented people.
3. **The build script fails loudly, not quietly.** `netlify-build.sh` hands the
   entire build to the fixture script if it ever sees the preview flag — which
   is correct for the preview site and a hazard for any other, so the flag is
   never set at repository level for a real site.
4. **Missing services are stated, never simulated.** Email, push and realtime
   are absent in staging and production; each is reported as
   `BLOCKED_BY_OWNER_SERVICE` or `BLOCKED_BY_DEPLOYMENT`, and no code path
   substitutes a fixture to hide the gap.
5. **The gates are executable.** `e2e/bundle-cleanliness.mjs` asserts these
   properties against the exported artifact in both directions — a real build
   must not contain the fixture world, a preview build must.
