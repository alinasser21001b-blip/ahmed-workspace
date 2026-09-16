# 03 — Stack Evaluation (PART 6)

Three realistic options, evaluated against the handoff's stated criteria (§34):
development speed, maintainability, AI coding compatibility, mobile deployment,
scalability, cost, ecosystem, security, developer availability.

A preference for TypeScript is stated in the handoff *because* the agents work well in it.
That is a legitimate input — the team is two AI agents and one person — but it is not
sufficient on its own, so each option is assessed on its own merits and the
recommendation is justified independently.

---

## Option A — TypeScript monorepo: Fastify + PostgreSQL + Expo + Next.js

One repository, one language, three deployables.

```
packages/contracts   Zod schemas shared by API, dashboard and app
packages/core        Pure domain logic: policy, pathway resolution, rules, formulas
apps/api             Fastify modular monolith  → container
apps/dashboard       Next.js                    → container or static+SSR host
apps/mobile          Expo / React Native        → App Store + Play
```

Deployed as long-running containers with managed PostgreSQL and S3-compatible object
storage.

| Criterion | Assessment |
| --- | --- |
| Development speed | High. One language, shared contracts, no serialisation boundary between teams that do not exist |
| Maintainability | High, **if** module boundaries are enforced. Medium if they are not |
| AI coding compatibility | Highest of the three. Strong typing gives agents a real feedback loop; one language means no context switching |
| Mobile deployment | Good. Expo manages the native build pipeline; one codebase for both platforms |
| Scalability | More than sufficient. PostgreSQL and a stateless API handle tens of thousands of patients on modest hardware |
| Cost | Low. Roughly $25–70/month at pilot scale |
| Ecosystem | Excellent |
| Security | Good. Mature, audited libraries for every primitive needed |
| Developer availability | Very good. TypeScript/React developers are the easiest to hire, including locally |

**Evidence:** `../../student-os` is this stack, at comparable complexity, with real CI,
integration tests, E2E journeys, RTL and accessibility audits, and documented ops. The
team has already executed this architecture once.

**Weaknesses.** Background work — reminder scheduling, the outbox relay, follow-up sweeps
— needs a worker process, which is an extra deployable. React Native's native surface is
where the unknowns live, and the team has no native expertise. Expo SDK upgrades are
periodic real work.

---

## Option B — Next.js full-stack + Supabase + Expo

Next.js (App Router, server actions) as both dashboard and API. Supabase for PostgreSQL,
auth, storage and row-level security. Expo for mobile against the Supabase client or a
thin API.

| Criterion | Assessment |
| --- | --- |
| Development speed | **Highest initially.** Auth, storage and a database on day one |
| Maintainability | Medium. Business logic tends to scatter across server actions, route handlers and RLS policies |
| AI coding compatibility | High, but see the authorization note below |
| Mobile deployment | Same as A |
| Scalability | Good. Same PostgreSQL underneath |
| Cost | Low initially; rises with usage, and egress/storage pricing can surprise |
| Ecosystem | Very good |
| Security | **The decisive concern.** See below |
| Developer availability | Very good |

**The authorization problem.** Supabase's model encourages pushing authorization into
row-level security policies. For this product that is the wrong place, for three reasons:

1. **Testability.** RLS policies are tested by running queries against a database. The
   authorization matrix here — every role × every resource × every operation × ownership
   — is hundreds of cases. As pure functions those are millisecond unit tests that run on
   every commit. As database policies they are slow integration tests that, in practice,
   get run less often and therefore protect less.
2. **Clinical authorization is not row-shaped.** "A dietitian may see nutrition entries
   but not surgical notes, for patients in their clinic, who are assigned to them, unless
   the patient has withdrawn consent" is awkward as a policy expression and clear as a
   function.
3. **A second path will appear.** Some feature — export, AI retrieval, an admin screen —
   will need the service role key, and at that moment there are two authorization
   implementations, one of which bypasses the other. The handoff (§42, §43) asks for
   centralised policy; RLS makes the centre the database while the application still
   needs its own answers.

**Where B is genuinely attractive:** Supabase as *managed PostgreSQL plus storage plus
an auth primitive*, with authorization still in an application policy layer, is a
reasonable hybrid. That is a hosting decision inside Option A, not a different
architecture — and it is worth considering on cost and operational-simplicity grounds.

**Other weaknesses.** Serverless plus PostgreSQL requires connection pooling discipline.
Background jobs need a separate mechanism. Vendor coupling is deeper than it first
appears.

---

## Option C — Python/FastAPI backend + Flutter mobile + React dashboard

| Criterion | Assessment |
| --- | --- |
| Development speed | Medium. Three languages, no shared contracts, hand-maintained parity |
| Maintainability | Good per-component; worse across the system |
| AI coding compatibility | Good per language, worse overall — agents lose the cross-boundary type feedback that catches contract drift |
| Mobile deployment | Good. Flutter is excellent, with strong RTL support |
| Scalability | Excellent |
| Cost | Comparable |
| Ecosystem | Excellent — and the strongest data/analytics/ML ecosystem of the three |
| Security | Good |
| Developer availability | Good, but "Python backend + Flutter + React" is three hiring pools |

**Where C wins.** If serious clinical research, cohort analysis or ML were a near-term
goal, Python's data ecosystem would be a real argument. If the team already had Flutter
expertise, that would be another. Neither applies here.

**Precedent in this workspace:** `../../medmind` is Python/FastAPI and works. But it is a
bot-and-pipeline backend with no rich client surface, so it does not carry the
three-language coordination cost that this product would.

**Weaknesses for this project.** Three languages for a one-person team. No shared
contracts, so API drift is found at runtime instead of at compile time — the single
largest source of avoidable bugs in multi-surface products. Dart is a fourth context for
the agents.

---

## Scoring

Weighted for *this* project: a one-person team with AI agents, a multi-year clinical
system, bootstrapped budget, Arabic-first, two client surfaces.

| Criterion | Weight | A | B | C |
| --- | --- | --- | --- | --- |
| Maintainability by a tiny team | 5 | 5 | 3 | 3 |
| AI coding compatibility | 5 | 5 | 4 | 3 |
| Security controllability | 5 | 5 | 3 | 4 |
| Development speed | 4 | 4 | 5 | 3 |
| Mobile deployment | 4 | 4 | 4 | 5 |
| Cost | 3 | 5 | 4 | 4 |
| Scalability | 3 | 4 | 4 | 5 |
| Ecosystem | 2 | 5 | 5 | 5 |
| Developer availability | 2 | 5 | 5 | 4 |
| **Weighted total** | | **147** | **127** | **126** |

The scoring is a summary of the reasoning above, not a substitute for it. The decisive
factors are the top three rows.

---

## Recommendation

**Option A**, with three specific decisions inside it.

### 1. The API runs as a long-lived container, not as serverless functions

This is the most important sub-decision and it comes directly from evidence in this
workspace. `student-os` ships its API as a Netlify function, and its own documentation
records the result: a production outage where the packaged function shipped without three
of its dependencies and threw before a line of it ran, while every CI check was green.
The team then had to build a bespoke packaging-verification gate to prevent a recurrence.

That cost is avoidable. This system additionally needs things serverless makes awkward:
persistent database connections, scheduled sweeps for overdue follow-ups, an outbox relay,
and reminder delivery. A single container on a managed host (Fly.io, Render, Railway, or a
Hetzner VPS with Docker) plus a managed PostgreSQL is simpler, cheaper at this scale,
easier to reason about, and easier to move.

**ADR-0002 will record this.**

### 2. Dashboard in Next.js, not React Native Web

> **Superseded by doc 11 §2.4.** The reasoning below — that the dashboard's dense tables and
> keyboard navigation are native to the web and fought for in React Native Web — still holds
> and is why the dashboard is not an Expo surface. The *framework* choice did not survive
> review: there is no SSR or SEO requirement for an authenticated internal tool, so the
> Next.js server was a second deployable and a second credential holder bought for nothing.
> **The dashboard is a Vite + React static SPA served by the Fastify process at the same
> origin.**

Sharing one Expo codebase across mobile and dashboard is tempting and wrong here. The
dashboard's core is dense tables, filters, multi-column layouts, keyboard navigation and
charts — all of which are native to the web platform and all of which are fought for in
React Native Web. The patient app and the dashboard also have genuinely different users,
different information density, and different release cadences. They share the contracts
package and the domain package; that is the sharing that pays.

### 3. Authorization in application code, whatever the hosting choice

Whether the database is self-managed PostgreSQL, Neon, or Supabase, the policy layer is
pure TypeScript functions in `packages/core/policy`, used identically by the API, the
dashboard, exports and any future AI retrieval path. Database-level RLS may be added as
defence in depth; it is never the primary mechanism.

### Proposed stack

| Layer | Choice | Note |
| --- | --- | --- |
| Language | TypeScript | Everywhere |
| API | Fastify, modular monolith | Container |
| Validation | Zod, shared contracts package | One source of truth for API shapes |
| Database | PostgreSQL 16+, managed | Plain SQL, file-based migrations |
| Migrations | Numbered forward-only SQL | Proven in `student-os` |
| Auth | Own implementation, Argon2id, **opaque DB-backed sessions** (not JWT) + rotating refresh | Decided — doc 12 §8.1. Credential *method* per audience remains doc 06 Q1 |
| Object storage | S3-compatible, private | **v1: API proxies every byte**, no presigned code path — ADR-0004, doc 11 §3.6 |
| Background work | Worker process in the same codebase | Scheduler + outbox relay |
| Dashboard | **Vite + React static SPA**, served by the Fastify process at the same origin | RTL from day one — superseded Next.js, doc 11 §2.4 |
| Mobile | Expo / React Native | One codebase, both platforms |
| Testing | Vitest + Playwright | Unit, integration, authorization, E2E, RTL, a11y |
| CI | GitHub Actions | Including a deployed-artifact gate |
| Hosting | **Decided:** Cloudflare edge → Railway (EU) for API, worker, PostgreSQL and object storage; off-provider encrypted backup to a third vendor | See [`11-ARCHITECTURE-DECISION-ADDENDUM.md`](./11-ARCHITECTURE-DECISION-ADDENDUM.md) §1.3–§2.3. Conditional on Gate 0 and `[IRAQI LEGAL REVIEW REQUIRED]` on residency |
| Errors | Self-hosted or PHI-scrubbed error tracking | Never raw request bodies |

### What would change my recommendation

- **Data residency inside Iraq is legally required** → hosting changes; the stack does
  not. Containerisation is what makes that cheap, which is another argument for it.
- **Near-term research/ML is a real goal** → Option C's data ecosystem becomes a genuine
  argument, and a hybrid (TypeScript API + Python analytics service reading a replica)
  becomes attractive.
- **Existing Flutter expertise is available** → Option C's mobile story improves
  materially.
- **Launch pressure is extreme and scope is halved** → Option B's hybrid form is the
  fastest path to something real, accepting the maintainability cost knowingly.
