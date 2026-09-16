# ADR-0001 — Modular monolith in TypeScript

**Status:** Proposed — awaiting Product Owner approval
**Date:** 2026-09-16
**Milestone:** M0

## Context

The product spans a dozen domains: identity, patients, pathway, measurements, nutrition,
medications, labs, symptoms, alerts, appointments, follow-up, documents, content,
notifications, audit. That breadth invites a service-per-domain split.

The team is **one person plus two AI agents plus a part-time engineer**. There is no
operations team, no platform team, and nobody to be paged.

Three stack options were evaluated in [`../03-STACK-EVALUATION.md`](../03-STACK-EVALUATION.md).

## Decision

**One deployable TypeScript application**, organised as modules under
`apps/api/src/modules/<domain>/`, each with `routes / service / repository / tests`, plus
**one worker process** from the same codebase for scheduled work and the outbox relay.

Cross-module calls go through **services**, never another module's repository. Pure domain
logic lives in `packages/core` with no dependencies, so it is shared unchanged by the API,
the worker, exports, and any future AI path.

TypeScript across API, dashboard and mobile, with Zod contracts shared between them.

## Consequences

**Good.** One deploy, one database, real foreign keys across domains, and atomic
transactions spanning domains — a symptom submission that also writes a domain event and
creates an alert is one transaction, not a distributed saga. Shared contracts mean API
drift is a compile error rather than a runtime bug. One language keeps the AI agents in
one context, which measurably improves their output. A team this size can hold the whole
system in their heads.

**Bad.** No independent scaling and no independent deploys. Module boundaries are enforced
by convention and review, not by the network — they *will* erode without discipline. A
single runtime fault can take down every domain at once. TypeScript is a weaker choice
than Python if clinical research and analytics become a priority.

**If this becomes a problem.** The boundary is already a service interface — a function
signature that can become an HTTP call. Extraction is mechanical when there is a genuine
reason. Microservices at this scale would buy distributed transactions, network failure
modes, and a deploy pipeline per service: all of the cost of scale with none of the scale.
