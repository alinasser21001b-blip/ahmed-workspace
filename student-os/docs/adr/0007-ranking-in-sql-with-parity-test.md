# ADR-0007 — Ranking lives in SQL, with a parity test against TypeScript

**Status:** Accepted · Phase 2

## Context

The V1 feed formula (§34) weighs course enrolment, weak topics, declared
interests, cohort, content kind, social proximity, engagement and recency. It
has to be applied to a permission-filtered set of content, ordered, and
paginated with a stable cursor.

Three options:

1. **Rank in TypeScript.** Fetch a candidate window, score it in `@sos/core`,
   sort, paginate. Testable and readable — but the page boundary is then a
   position in an in-memory array, which is offset pagination wearing a
   disguise. It duplicates and skips rows under concurrent writes.
2. **Rank in SQL only.** Correct pagination, but the formula becomes a wall of
   `CASE WHEN` that no product person can read and no unit test can reach.
3. **Both, held together by a test.**

## Decision

Option 3. The formula exists twice:

- `packages/core/src/ranking/feed-ranking.ts` — the readable specification,
  unit-tested, where the weights are declared.
- `apps/api/src/modules/content/feed.sql.ts` — the implementation, because
  ordering and keyset pagination have to happen in the query.

The **weights are bound as query parameters from `FEED_WEIGHTS`**, so the
numbers have exactly one home. Only the arithmetic shape is duplicated.

`test/feed-parity.integration.test.ts` scores the same rows through both paths
and asserts they agree to six decimal places.

## Consequences

**Good.** Correct keyset pagination on a ranked feed. The formula stays
readable and unit-testable. A product change to a weight is a one-line edit to
a TypeScript constant. Divergence fails a test rather than silently changing
what students see.

**Bad.** Two implementations of the same arithmetic. Adding a *term* (not a
weight) means editing both places, and the parity test only catches it if the
new term fires on the fixtures.

**Mitigation.** The parity test builds its candidates from the database rather
than from test literals, so it exercises the real stored state. When a term is
added, the fixture set must be extended to fire it — which is called out in the
test's comments.

## Also decided here

The feed query deliberately does **not** apply the platform-admin bypass that
`canViewContent` grants. An admin's home feed is their own cohort's feed; admin
reach is a moderation surface, reached through the single-item read that does
go through the policy. Two paths, one policy, documented divergence.
