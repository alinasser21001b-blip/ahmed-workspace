# ADR-0003 — Exactly one authorization implementation

**Status:** Accepted · Phase 0

## Context

The Constitution requires that AI never reach content the user cannot reach
(§29), and that the same authorization apply to UI, API, search, files and AI
(§4.5). Systems normally fail this by growing a second, "trusted" path for the
retrieval pipeline.

## Decision

Authorization lives in `packages/core/policy` as **pure, synchronous functions**
over a fully-resolved `Actor`. The REST API, search, file access and the AI
retrieval pipeline all call the same functions. There is no privileged path.

Two mechanisms:
1. `canViewContent(actor, content)` for single-object decisions.
2. `visibilityScopesFor(actor)` for list queries, which pushes the actor's
   scopes into the SQL `WHERE` clause.

List endpoints **must not** fetch-then-filter: that leaks row counts through
pagination and returns short pages.

## Consequences

**Good.** The security surface is covered by fast unit tests over pure
functions rather than slow integration tests, so it is actually tested often.
The `Actor` is built once per request, which makes "what can this user reach?"
a single auditable query. AI permission leakage becomes provable rather than
aspirational.

**Bad.** The caller must load every membership set up front, even for requests
that need only one. At cohort scale these sets are tens of rows.

**If that becomes expensive**, cache the `Actor` per request-batch. Do not make
the policy layer lazy — laziness is how the second path gets born.
