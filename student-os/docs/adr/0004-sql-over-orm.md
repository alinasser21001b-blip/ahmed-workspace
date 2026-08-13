# ADR-0004 — Hand-written SQL in repositories, not an ORM

**Status:** Accepted · Phase 0

## Context

The queries that matter here are the feed (ranked, permission-filtered,
cursor-paginated) and permission-filtered list endpoints.

## Decision

`pg` with parameterised SQL, contained in `*.repository.ts`. Migrations are
numbered `.sql` files with a ~120-line runner providing an advisory lock,
checksums and per-migration transactions.

## Consequences

**Good.** The permission filter in a list query is visible in review as SQL. An
ORM would hide exactly the clause that must not be wrong. No lazy-loading N+1
surprises; no migration DSL to fight when a partial index or a CHECK constraint
is needed — and this schema uses many of both.

**Bad.** More boilerplate for simple CRUD. Row types are hand-declared, so a
schema change requires updating the interface.

**Mitigation.** Repositories are thin and mechanical; integration tests run
against real Postgres, so a drifted row type fails the suite rather than
production.

**Rejected.** Prisma (migration DSL cannot express several constraints used
here), Drizzle (closer, but still an abstraction over the clause that most
needs to be legible).
