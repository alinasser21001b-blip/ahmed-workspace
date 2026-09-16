# ADR-0003 — Exactly one authorization implementation

**Status:** Proposed — awaiting Product Owner approval
**Date:** 2026-09-16
**Milestone:** M1

## Context

This system holds the medical records of a named surgeon's patients in a community where
the social consequences of exposure are real. Broken access control is the failure mode
most likely to occur and the one with the worst consequences
([`../02-RISK-REGISTER.md`](../02-RISK-REGISTER.md) R6).

The handoff requires centralised authorization policy (§42, §43) rather than role checks
scattered through the codebase.

Systems normally fail this in one specific way: they grow a **second, "trusted" path**.
Some feature — a CSV export, an analytics job, an admin screen, an AI retrieval pipeline —
needs data across users, so it is given a privileged database role and bypasses the policy
layer. From that moment the security model is whatever the weakest path allows.

## Decision

Authorization lives in `packages/core/policy` as **pure, synchronous functions** over a
fully resolved `Actor`. Two mechanisms:

1. `canViewPatient(actor, patient)` and siblings, for single-object decisions.
2. `patientScopesFor(actor)`, whose result is pushed into the SQL `WHERE` clause for list
   queries.

**The REST API, the dashboard, the worker, exports, and any future AI retrieval path call
the same functions. There is no privileged path.** List endpoints must not fetch-then-
filter: that leaks row counts through pagination and returns short pages.

Roles and permissions are **data**. There is no `if (role === 'doctor')` anywhere outside
the policy module.

Database-level row security may be added later as defence in depth. It is never the
primary mechanism — see [`../03-STACK-EVALUATION.md`](../03-STACK-EVALUATION.md) for why.

**This ADR is not sufficient on its own.** It constrains code that already reaches the policy
layer. It says nothing about paths that never enter the application — a client database SDK,
a service-role key, an analytics job, a provider integration — and those are what actually
cause breaches. [`ADR-0004`](./0004-one-public-clinical-data-gateway.md) closes that gap and
must be read with this one.

## Consequences

**Good.** The security surface is covered by fast unit tests over pure functions, so the
full role × resource × operation matrix runs on every commit rather than nightly. The
`Actor` is resolved once per request, which makes "what can this user reach?" a single
auditable question. Adding a role is configuration. Cross-clinic leakage becomes provable
rather than hoped for.

**Bad.** Every request loads the actor's full membership and assignment set, even when it
needs one field. Discipline is required forever: the day someone adds a repository call
that skips the policy layer, this ADR is violated silently and nothing fails.

**If this becomes expensive.** Cache the resolved `Actor` per request batch. **Do not make
the policy layer lazy or optional** — laziness is exactly how the second path gets born.

**Verification.** A test asserts that no query returns rows across `clinic_id` boundaries.
A human penetration test before launch targets this specifically, because tests written by
the author of the code inherit the author's blind spots.
