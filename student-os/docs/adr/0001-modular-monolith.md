# ADR-0001 — Modular monolith, not microservices

**Status:** Accepted · Phase 0

## Context

The product spans a dozen domains (social, messaging, learning, AI, moderation,
admin). That breadth invites a service-per-domain split, and the Constitution
(§4.6, §45, §86) explicitly warns against it.

## Decision

One deployable TypeScript application, organised into modules under
`apps/api/src/modules/<domain>/`, each with `routes / service / repository /
policy / tests`. Cross-module calls go through **services**, never repositories.

## Consequences

**Good.** One deploy, one database, real foreign keys across domains, atomic
transactions spanning social and learning writes (a quiz submission that also
writes a learning event is one transaction, not a saga). A team of one to three
people can hold it in their heads.

**Bad.** No independent scaling or independent deploys. Module boundaries are
enforced by convention and review, not by the network.

**Mitigation.** The boundary is the service interface. When a module genuinely
needs to be extracted, its callers already go through a function signature that
can become an HTTP call. Nothing about the current structure blocks that.

Microservices at 100 users would mean distributed transactions, network
failure modes, and a deploy pipeline per service — all of the cost of scale
with none of the scale.
