# Student Social Learning OS

A social learning operating system for a dense student cohort. Social feed,
communities, study groups, messaging, classrooms, lectures, quizzes and an AI
layer — built as **one academic graph**, not as separate products stapled
together.

> Status: **Phases 0–3 complete** — Foundation, Identity, Social core, and
> Community. 209 tests passing. The full journey — sign up, publish, comment,
> like, save, create a study group, post inside it, and find it by search —
> runs end-to-end in a real browser, in Arabic.

## Read this first

| Document | What it answers |
| --- | --- |
| [Product Architecture](docs/00-PRODUCT-ARCHITECTURE.md) | What this is, and what makes it one system |
| [Technical Architecture](docs/01-TECHNICAL-ARCHITECTURE.md) | Stack, module contract, request lifecycle, AI pipeline |
| [Data Model](docs/02-DATA-MODEL.md) | 77 tables and the decisions behind them |
| [API Contract](docs/03-API-CONTRACT.md) | Endpoints, auth, errors, pagination |
| [UX Architecture](docs/04-UX-ARCHITECTURE.md) | Screens, navigation, design rules |
| [Roadmap](docs/05-ROADMAP.md) | Phases and exit criteria |
| [ADRs](docs/adr/) | Decisions that were not obvious |

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

Requires Node 22+, pnpm, PostgreSQL 16.

```bash
pnpm install

# database
createdb studentos_dev && createdb studentos_test
cp apps/api/.env.example apps/api/.env     # then set JWT_SECRET
pnpm db:migrate
pnpm db:seed                                # University of Baghdad → Medicine → Stage 5

# run
pnpm dev:api                                # http://localhost:4000
pnpm dev:mobile                             # Expo dev server
```

## Tests

```bash
pnpm typecheck          # all four packages
pnpm test:unit          # 115 unit tests (@sos/core)
pnpm test:integration   # 94 integration tests against real Postgres
```

Integration tests run against a **real database**, not a mock. Permission bugs
— the class of bug this product can least afford — do not reproduce against a
mock, because the mock agrees with whatever the code believes.

### End-to-end

The first user journey (§91 of the product constitution) is a test, not a
checklist:

```bash
pnpm --filter @sos/api db:reset && pnpm --filter @sos/api db:seed
pnpm dev:api &
pnpm --filter @sos/mobile export:web
npx serve apps/mobile/dist -l 8081 --single &
node apps/mobile/e2e/first-journey.mjs
```

It runs **in Arabic**, because Arabic is the primary language and RTL is where
layout bugs actually appear.

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
| Messages survive bad networks | Server-assigned `seq`, client-minted idempotency key, unit-tested state machine |
| The feed cannot leak across cohorts | The permission filter is pushed into the SQL `WHERE`, never applied after the fetch ([ADR-0003](docs/adr/0003-single-authorization-layer.md)) |
| Ranking matches its documented formula | SQL and TypeScript implementations compared by a parity test ([ADR-0007](docs/adr/0007-ranking-in-sql-with-parity-test.md)) |
| An upload is what it claims to be | Format read from magic bytes; the declared MIME type is discarded |
| A private group leaks nowhere | The same predicate gates the feed, the item read and search — tested across all three ([ADR-0008](docs/adr/0008-trigram-search.md)) |
| A restriction is not a suspension | `canRead` and `isActive` are separate gates: restricted accounts read, they do not write |

## Deliberately not built yet

Payments, ads, marketplace, monetisation, ML recommendation, custom video
infrastructure, custom cryptography, microservices, Kubernetes, enterprise org
management, full LMS/grading replacement, follower economy.

The schema reserves room for several of these. None is implemented.
