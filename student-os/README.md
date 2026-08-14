# Student Social Learning OS

A social learning operating system for a dense student cohort. Social feed,
communities, study groups, messaging, classrooms, lectures, quizzes and an AI
layer — built as **one academic graph**, not as separate products stapled
together.

> Status: **Phases 0–5 complete** — Foundation, Identity, Social core,
> Community, Messaging, and the Knowledge foundation. 368 tests passing, plus
> an API smoke suite and three browser suites: the first journey, a layout
> audit over every screen in Arabic and English on phone and desktop, and a
> two-user messaging journey that drops a real connection mid-conversation.
> The full journey — sign up, publish, comment, like, save, create a study
> group, post inside it, and find it by search — runs end-to-end in a real
> browser, in Arabic.
>
> Phase 3 was closed by an audit rather than by a green test run
> ([docs/06-PHASE-3-AUDIT.md](docs/06-PHASE-3-AUDIT.md)), which found twelve
> issues including a group that could be permanently stranded without an owner,
> mutes that changed nothing, a CI step that had been red since Phase 0, and
> Arabic search that returned nothing for diacritised text.
>
> Phase 5 began the same way, with an audit before any code
> ([docs/07-PHASE-5-AUDIT.md](docs/07-PHASE-5-AUDIT.md)). It found the schema
> already knowledge-shaped, so the phase added three tables and three columns
> rather than a subsystem — and re-scoped itself from "classrooms" to the
> classification, provenance and topic layer those rooms need underneath them.

## Read this first

| Document | What it answers |
| --- | --- |
| [Product Architecture](docs/00-PRODUCT-ARCHITECTURE.md) | What this is, and what makes it one system |
| [Technical Architecture](docs/01-TECHNICAL-ARCHITECTURE.md) | Stack, module contract, request lifecycle, AI pipeline |
| [Data Model](docs/02-DATA-MODEL.md) | 80 tables and the decisions behind them |
| [API Contract](docs/03-API-CONTRACT.md) | Endpoints, auth, errors, pagination |
| [UX Architecture](docs/04-UX-ARCHITECTURE.md) | Screens, navigation, design rules |
| [Roadmap](docs/05-ROADMAP.md) | Phases and exit criteria |
| [Phase 3 Closure Audit](docs/06-PHASE-3-AUDIT.md) | What was actually true at the end of Phase 3, and what was done about it |
| [Phase 5 Audit](docs/07-PHASE-5-AUDIT.md) | What already existed before the knowledge layer was built, what was missing, and what was deliberately deferred |
| [ADRs](docs/adr/) | Decisions that were not obvious |

**Knowledge is the social object.** This is an academic social learning network,
not a social network with course material on it. What that rules in and out —
no entertainment feed, no virality model, no engagement-for-its-own-sake
mechanics, and knowledge that stays discoverable instead of disappearing into
chats — is [§1.1 of the product architecture](docs/00-PRODUCT-ARCHITECTURE.md),
and it constrains every phase from here.

## Layout

```
packages/contracts   Zod schemas + types — the API contract, as code
packages/core        Pure domain logic: authorization, learning signals,
                     message state machine, feed ranking. No I/O.
apps/api             Fastify modular monolith + PostgreSQL
apps/mobile          Expo Router client (iOS / Android / web)
```

`@sos/core` has no I/O dependencies, which is what allows the entire security
surface to be covered by fast unit tests instead of slow integration tests.

## Getting started

Requires Node 22+, pnpm, and a running PostgreSQL 16.

```bash
pnpm install
pnpm dev
```

`pnpm dev` finds your PostgreSQL, **creates the databases if they do not exist**,
migrates them, seeds the academic hierarchy and a small demo cohort, then starts
the API and the web client together. There is no connection string to configure:
it tries the usual local ones — a Homebrew install that trusts your login user, a
Debian one that wants `postgres`/`postgres` — and uses the first that answers.
Set `DATABASE_URL` yourself and that wins instead. Open the URL it
prints — **http://localhost:8081** — and sign in with any of the accounts it
lists (password `correct-horse-battery`):

| account | what it shows |
|---|---|
| `amjad@uob.edu.iq` | verified instructor and platform administrator — sees the join code, the draft lecture, and can open a classroom |
| `zainab@uob.edu.iq` | ordinary student |
| `omar@uob.edu.iq` | ordinary student |

Both servers reload on save; Ctrl-C stops them together.

### Configuration

Configuration comes from the **process environment**, not from a `.env` file —
nothing in the codebase loads one, which is how CI supplies it too. `pnpm dev`
exports working defaults, and sources `apps/api/.env` first if you have created
one, so customising it still works:

| variable | default under `pnpm dev` | required in production |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/studentos_dev` | yes |
| `JWT_SECRET` | a development value | yes, ≥32 chars |
| `PORT` | `4000` | no |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | **yes, at build time** |

`EXPO_PUBLIC_API_URL` is the one that bites. A web bundle has no runtime
environment, so the API address is frozen in at build time:
`pnpm --filter @sos/mobile build:web` **refuses to build without it** rather
than shipping an app addressed to the machine that built it.

### Running the individual pieces

```bash
pnpm dev:api      # API only, http://localhost:4000
pnpm dev:mobile   # Expo dev server only (device/simulator)
pnpm db:reset     # drop and rebuild the schema from the migrations
pnpm demo:seed    # demo cohort (needs the API running; idempotent)
```

## Tests

```bash
pnpm typecheck          # all four packages
pnpm test:unit          # 261 unit tests (@sos/core, @sos/api, @sos/mobile), no database needed
pnpm test:integration   # 219 integration tests against real Postgres
```

Integration tests run against a **real database**, not a mock. Permission bugs
— the class of bug this product can least afford — do not reproduce against a
mock, because the mock agrees with whatever the code believes.

### Which database the tests use, and why you cannot get it wrong

The integration suite **drops and rebuilds the schema on every run**. That is
deliberate — it re-proves the migration path each time instead of trusting it —
and it means the only thing standing between the suite and a database you care
about is a connection string.

So the string is not taken from your environment. It is resolved from
`TEST_DATABASE_URL`, defaulting to
`postgres://postgres:postgres@localhost:5432/studentos_test`, and checked
against a contract before anything connects:

| A database may be destroyed by the test suite only if | |
| --- | --- |
| its **name ends in `_test`** | rules out `studentos_dev` by name, not by hope |
| its **host is private** | localhost, or a single-label container hostname. A production database lives behind a dotted public name and cannot satisfy this |
| `NODE_ENV` **is not `production`** | |

`DATABASE_URL` is never consulted when choosing the target. If one is set in
your shell and it is not this run's test database, the suite **refuses to
start** rather than overriding it silently — because a shell that has the wrong
`DATABASE_URL` is about to run migrations and seeds too, and you should know.

```
$ DATABASE_URL=postgres://…/studentos_dev pnpm test:integration
The integration suite refused: DATABASE_URL is set in this environment and does
not match the test database. … The suite DROPS THE SCHEMA of the database it
runs against …
```

The usual cause is `source apps/api/.env` in the same shell. Either open a
shell without it or `unset DATABASE_URL`.

The rule is asserted three times — when Vitest loads its config, in the global
setup, and again inside `resetTestDatabase` at the moment of destruction — from
one shared definition in `apps/api/src/platform/database-safety.ts`. The
innermost check is the one that matters: it makes "tests cannot drop the dev
database" a property of the code rather than of how you happen to call it.

To use a different test database, set `TEST_DATABASE_URL` — the name must still
end in `_test`.

### End-to-end

The first user journey (§91 of the product constitution) is a test, not a
checklist:

```bash
pnpm --filter @sos/api db:reset && pnpm --filter @sos/api db:seed
pnpm dev:api &
pnpm --filter @sos/mobile export:web
npx serve apps/mobile/dist -l 8081 --single &

pnpm --filter @sos/api demo:seed            # a cohort with real content
node apps/mobile/e2e/smoke.mjs              # 78 API checks across every area

pnpm test:e2e        # the first journey, in Arabic
pnpm test:messaging  # two students, two browsers, one dropped connection
pnpm test:rtl        # every screen, ar/en × phone/desktop
```

`smoke.mjs` mutates and several of its assertions count rows, so it expects a
freshly seeded database: `db:reset && db:seed && demo:seed` before each run.

The journey runs **in Arabic**, because Arabic is the primary language and RTL
is where layout bugs actually appear. It asserts that the home feed offers
either a real empty state or real cohort content — not that the database
happens to be empty, which was only ever true on the first run.

`test:rtl` checks direction, horizontal overflow, clipped text, hit areas,
directional-icon geometry, the console and the network on every screen — 272
checks, including the Phase 5 topic and knowledge surfaces. It exists because
the three worst RTL defects in this repository were all invisible to code
review and to a single screenshot.

All of it runs in CI, against a real API and a real bundle.

## CI

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) at the
**repository root** — not inside `student-os/`. This matters: GitHub Actions
only discovers workflows at the root, so the copy that used to live at
`student-os/.github/workflows/ci.yml` was never registered and never ran. Zero
checks on a pull request read like "nothing to report" and actually meant
"nothing was run".

The repository root is a workspace holding several unrelated projects, so the
workflow is scoped to this one: a `paths` filter on `student-os/**` decides when
it runs, and `working-directory: student-os` means no step can reach a sibling
project. A pull request touching only another project shows no checks from it,
which is correct rather than a repeat of the old failure.

Two jobs, each with its own disposable Postgres 16 service container that starts
empty and dies with the runner:

| Job | What it proves |
| --- | --- |
| **verify** | typecheck, lint, unit, integration, migrations from an empty database (asserting applied count equals files on disk), API build, client bundle |
| **journey** | seed → serve → the 78-check API smoke suite, the Arabic first journey, the two-browser messaging journey, and the RTL/layout audit |

No credential in this repository points anywhere but a container that lives for
minutes. The `verify` job deliberately sets **no** `DATABASE_URL` at all — only
`TEST_DATABASE_URL` — so CI exercises the same resolution path a developer does.

## Principles that are enforced, not aspirational

| Principle | Mechanism |
| --- | --- |
| AI can never reach content the user cannot | One authorization implementation in `packages/core/policy`, called by API, search, files and AI alike ([ADR-0003](docs/adr/0003-single-authorization-layer.md)) |
| Private group content cannot leak to the cohort feed | Containers are hard boundaries in the policy layer; unit-tested |
| Never trust client-supplied identity | Zod validation rejects unknown fields; identity comes from the token; tested |
| No hardcoded academic hierarchy | Every level is a database row; nothing about medicine or Baghdad appears outside the seed file |
| No hardcoded UI strings | English catalogue typed against Arabic — a missing translation is a compile error |
| Every async surface has loading / empty / error / retry | `states.tsx` primitives |
| Learning signals are not claims about learning | Named `learning signals` in schema, API and UI, with a visible disclaimer |
| Messages survive bad networks | Server-assigned `seq`, client-minted idempotency key, and a two-browser E2E that drops a real connection and checks the gap replays once, in order ([ADR-0011](docs/adr/0011-realtime-notifies-database-decides.md)) |
| A realtime frame never outruns the database | Every write is HTTP and committed before it is announced; the socket is an optimisation over a plain `afterSeq` read, so a dropped connection is late data, never lost data |
| Nobody reads a conversation they are not in | No admin bypass exists for messaging, deliberately — a post was published to an audience, a message was not |
| The feed cannot leak across cohorts | The permission filter is pushed into the SQL `WHERE`, never applied after the fetch ([ADR-0003](docs/adr/0003-single-authorization-layer.md)) |
| Ranking matches its documented formula | SQL and TypeScript implementations compared by a parity test ([ADR-0007](docs/adr/0007-ranking-in-sql-with-parity-test.md)) |
| An upload is what it claims to be | Format read from magic bytes; the declared MIME type is discarded |
| A private group leaks nowhere | The same predicate gates the feed, the item read and search — tested across all three ([ADR-0008](docs/adr/0008-trigram-search.md)) |
| A restriction is not a suspension | `canRead` and `isActive` are separate gates: restricted accounts read, they do not write |
| Access is not one boolean | `canView`, `canRead`, `canWrite`, `canPost`, `canComment`, `canJoin`, `canLeave`, `canInvite`, `canModerate`, `canManage` are separate decisions with separate reason codes, resolved together by `groupCapabilities` and projected — never re-derived — by the client |
| A group cannot be stranded | The owner's exit rule lives in `canLeaveGroup`, and both routes out of a group go through it ([audit F1](docs/06-PHASE-3-AUDIT.md)) |
| A mute changes what you see | Filtered in the feed's SQL, on ambient surfaces only — a mute is a volume control, not a lockout |
| Arabic search finds Arabic | Meaning-preserving normalisation on both the column and the query, with a TypeScript/SQL agreement test ([ADR-0009](docs/adr/0009-arabic-normalisation.md)) |
| Arabic counts read like Arabic | CLDR's six plural categories, not an English rule with a suffix |
| The Arabic UI is designed, not mirrored | Navigation icons flip; play buttons, clocks and checkmarks do not ([`DirectionalIcon`](apps/mobile/src/components/DirectionalIcon.tsx)) |
| Every event has one delivery path | A transactional outbox, written in the same transaction as the change ([ADR-0010](docs/adr/0010-domain-events-outbox.md)) |
| Knowledge is never scored | Provenance is a class computed from counted rows, never a stored float. Two sources means two documents a reader can open ([ADR-0013](docs/adr/0013-provenance-classes.md)) |
| A correction outlives the thread it started in | `content_corrections` is a first-class row with a lifecycle, not comment 40 — a reader six months later sees it either way |
| A citation is not a privilege | Anyone who can see a piece of knowledge may cite it; `addedBy` records who made the claim |
| Sources and corrections cannot leak | They hang off `/content/:id/…` and run the content's own predicate, so their visibility *is* its visibility — 404 for a non-member, on both |
| A machine's classification can never pass as a person's | `content_topics.source` and `topic_relations.source` are carried to the client before any classifier exists; a graph that merges them can never be un-merged ([ADR-0013](docs/adr/0013-provenance-classes.md)) |
| The feed optimises for learning value | Classification and citation outweigh engagement, disputed content is penalised, and `reel` earns no academic bonus — with the SQL/TS parity test still holding ([ADR-0007](docs/adr/0007-ranking-in-sql-with-parity-test.md)) |
| A weak signal says it is weak | A weakness computed from too few answers is returned with `lowConfidence` and rendered with the caveat on the row, not in a footnote ([ADR-0014](docs/adr/0014-learning-signals-are-not-analytics.md)) |
| A screen never shows a control that does nothing | The Learn tab renders only sections backed by rows that exist; the topic filter offers only types with a non-zero permission-filtered count |

## Deliberately not built yet

Payments, ads, marketplace, monetisation, ML recommendation, custom video
infrastructure, custom cryptography, microservices, Kubernetes, enterprise org
management, full LMS/grading replacement, follower economy.

The schema reserves room for several of these. None is implemented.
