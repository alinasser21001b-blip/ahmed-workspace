# ADR-0002 — The API runs as a long-lived container, not as serverless functions

**Status:** Proposed — awaiting Product Owner approval
**Date:** 2026-09-16
**Milestone:** M0

## Context

The obvious modern default is to deploy the API as serverless functions on a platform with
a generous free tier. The sibling project `../../../student-os` in this workspace does
exactly that.

Its own documentation records what that cost. The packaged function shipped without three
of its dependencies and threw `Cannot find package 'zod'` before a line of it ran —
**production returned 502 to every request while every CI check was green**, because
nothing in the pipeline tested the artifact that actually ships. A failed boot also leaked
a filesystem path, a stack frame and a connection string to the public before that was
fixed. The team then had to build a bespoke packaging-verification gate to stop it
recurring.

This system additionally needs things serverless makes awkward:

- **Persistent database connections.** Serverless plus PostgreSQL means a pooler and
  connection-limit discipline as permanent overhead.
- **Scheduled work.** Overdue-follow-up sweeps and reminder dispatch are not
  request-triggered.
- **An outbox relay** draining domain events continuously.
- **Predictable latency.** Cold starts on a clinical dashboard are a daily irritation for
  staff who use it all day.

## Decision

The API runs as a **long-lived container** on a managed container host, alongside a
**worker container** from the same image for scheduled work and the outbox relay, with
**managed PostgreSQL** and **S3-compatible object storage**.

CI still includes a deployment-contract gate that exercises the built artifact rather than
the source tree. The lesson from the incident is not "serverless is bad" — it is "test what
ships".

## Consequences

**Good.** No packaging-shape failure class. Connection pooling is ordinary. Scheduled work
and the relay are a process, not an architecture. No cold starts. The application is
portable — if data residency requires moving to a provider inside Iraq, a container moves
and functions do not. Local development matches production closely.

**Bad.** A small fixed monthly cost instead of a free tier. We manage a process: restarts,
health checks, graceful shutdown, memory limits. Scaling is manual until it is configured.
Two deployables instead of one.

**If this becomes a problem.** At this scale it will not be load. If the fixed cost is
genuinely prohibitive, the same container runs on a single small VPS for less than the
managed host. The application code does not change either way — which is the point.
