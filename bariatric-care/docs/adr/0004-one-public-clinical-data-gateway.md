# ADR-0004 — One public clinical-data gateway

**Status:** Proposed — awaiting `HOSTING AND DATA ARCHITECTURE APPROVED`
**Date:** 2026-09-16
**Milestone:** M1
**Analysis:** [`../11-ARCHITECTURE-DECISION-ADDENDUM.md`](../11-ARCHITECTURE-DECISION-ADDENDUM.md)
§3 and §5. This record is longer than this directory's own one-page rule allows, because it
has to carry an enforceable violation list; the reasoning lives in document 11.

## Context

This system holds the medical records of a named surgeon's patients in a community where the
social consequences of exposure are real. Broken access control is both the most likely
failure and the worst one (risk R6).

Systems fail this in one characteristic way: they grow a **second, privileged path**. Some
feature — an export, an analytics job, an admin screen, an AI retrieval pipeline, a
convenient platform integration — needs data across users, so it is given a credential that
reads more than any user may read. From that moment the security model is whatever the
weakest path allows, and the first path's careful policy layer is decoration.

ADR-0003 already established one authorization implementation *inside* the application. It
does not say anything about paths that never enter the application at all, and those are the
ones that actually cause breaches.

The principle was attacked before adoption (document 11 §3.2). Two objections changed the
wording; none defeated the decision.

## Decision

> **Every read or write of clinical data — from any client, service, job, script or tool —
> resolves an Actor and passes the same policy implementation before any repository call.**

The thing centralised is **authorization**, not exposure. This is deliberate and it is the
correction the original phrasing needed:

- **One policy implementation.** Non-negotiable.
- **One public origin.** *Not* required. Multiple hostnames with different edge exposure are
  permitted, provided they terminate in the same policy implementation.
- **One process.** *Not* required. The worker reuses the policy and repository layer
  in-process under a per-job scoped `JobActor` (§Allowed paths). It does **not** call the API over HTTP: an
  internal HTTP hop inside one trust boundary buys nothing and costs a service credential
  that becomes exactly the second privileged path this ADR exists to prevent.

## Security boundary

The boundary is the **policy layer**, not the network edge:

```
any caller → Actor resolution → policy functions → services → repositories → data
```

A caller is inside the boundary when it has traversed policy with a resolved Actor. Network
position grants nothing. A Cloudflare Access assertion, a private-network origin, a platform
console session and a CI runner are all **outside** the boundary, and none of them may
produce an Actor, a permission or a `clinic_id`.

## Trust boundaries

| Zone | Contains | Trusted to |
| --- | --- | --- |
| Untrusted | Patient app, dashboard bundle, the internet | Nothing. Every input is validated server-side |
| Edge | Cloudflare | Filter volume and shape. **Never** to assert identity |
| Application | Fastify API, worker | Resolve Actors and enforce policy |
| Data | PostgreSQL, object storage | Nothing — they enforce no policy of their own in v1 |
| Operator | Provider console, CI, break-glass | Audited, exceptional, never routine |

## Allowed access paths

1. Patient app → edge → API → policy → services → repositories → PostgreSQL / storage.
2. Dashboard → same, from the same origin that serves its bundle.
3. Worker → **the same policy and repository layer, in-process**, under a **per-job
   `JobActor`** — never one shared "system" identity, which would be exactly the unscoped god
   worker this rule exists to prevent. Each JobActor carries a concrete `clinic_id` (never a
   wildcard) and a narrow declared table scope, and the worker connects under its own database
   role rather than the API's. Audit events name the job, the run and the triggering event.
   Specified in [`../12-REVIEW-RESPONSE-AND-ACCESS-DESIGN.md`](../12-REVIEW-RESPONSE-AND-ACCESS-DESIGN.md) §4.
4. Exports → the same `patientScopesFor(actor)` pushed into the same `WHERE`, plus an audit
   event recording actor, filter and row count.
5. Documents → **bytes streamed through the API** after the policy call. No presigned URL
   code path exists in v1.
   **Read this precisely.** A short-lived, object-scoped signed URL minted *after* an
   authorization decision **conforms to this ADR** — authorization happened at the boundary
   and only the byte transfer is delegated. "One gateway" has never meant "every byte through
   Fastify". v1 proxies bytes for *audit and leakage* reasons (document 11 §3.6), not because
   this rule forbids the alternative. Adopting signed URLs later is therefore a **product
   decision against the triggers named there, not an amendment to this ADR.**
6. Future AI → an approved context builder that is an ordinary caller: it resolves an Actor,
   calls the same policy functions, and receives only what that Actor could have read.

## Forbidden access paths — the violation list

A **violation** is any read or write of clinical data that reaches the database or object
storage **without resolving an Actor and passing the policy layer**. Network location,
convenience and good intentions are irrelevant.

| Path | Verdict | Why |
| --- | --- | --- |
| Mobile app → Supabase (or any DB SDK) directly | **Violation** | A second authorization implementation with different semantics and a weaker test story. The client also becomes a place a privileged key can leak. |
| Dashboard → PostgreSQL directly | **Violation** | Requires database credentials in a browser. Catastrophic and unrecoverable — the credential is public the moment it ships. |
| AI service → database with service-role credentials | **Violation** | The canonical second path. An AI component must never hold a credential that reads more than the user it is acting for. |
| Analytics job → unrestricted production database | **Violation as stated.** Allowed shape: a read-only role against a **restored backup or replica**, with direct identifiers removed. If a question genuinely needs identifiers it is a report and goes through the API. | Unrestricted production SQL is indistinguishable from a breach in the audit trail. |
| Worker → database bypassing authorization | **Depends — and this is the distinction that matters.** Reusing the policy and repository layer under a scoped per-job `JobActor` is **allowed** and is the design. Ad-hoc SQL from the worker that skips policy is a **violation**. | "Bypassing the API" is fine. "Bypassing authorization" is not. They are different things and conflating them is how this rule gets misread. |
| Client → private storage bucket directly | **Violation in v1.** No presigned URL path exists. | A presigned URL is a bearer token inside a URL; in this population it lands in screenshots and WhatsApp forwards. And you cannot audit a read that never reaches your API. |
| Admin script → production database | **Violation as routine practice. Allowed as break-glass** under §Exceptions. | Routine console SQL is how every control erodes. |
| CSV export → custom unrestricted SQL | **Violation** | An export is a privileged *read*, not a different kind of access. Same scopes, same `WHERE`, plus an audit event. |
| **Provider MCP / AI agent integration connected to the production account** | **Violation** | The highest-probability bypass on this project. Integrations of this shape expose tools that query the production database and rewrite environment variables without touching the API, the policy layer or the audit trail. Agent tooling is restricted to development and staging. |

## Exceptions

Four, named exhaustively so that nothing else can be smuggled in as "also an exception":

1. **Schema migrations.** Run under a `migrator` role whose credential is absent from the API
   container, in CI, and must not read PHI.
2. **Backup and restore.** Operates on the whole dataset by definition. Compensating
   controls: encryption at rest with a key held separately, an off-provider immutable copy,
   and an audit record of every restore.
3. **Break-glass operator access.** A separate, time-boxed credential; a typed reason
   required; an out-of-band alert fired; reviewed monthly. Allowed because refusing it
   entirely guarantees it is worked around during a real emergency.
4. **Provider platform support access.** Outside our control; governed by contract, not
   architecture. Recorded here so it is not mistaken for a path we designed.

Every exception is logged where the application cannot suppress it.

## Enforcement mechanisms

A rule nothing enforces is decoration. In descending order of strength:

| Mechanism | Enforces |
| --- | --- |
| **Branded `Scope` type** that only the policy layer can construct; repositories require it | Makes an unscoped query a **compile error** |
| **Boot-time route assertion** — every route schema carries a required `policy` property; the process **exits at startup** if any route lacks one | Repairs ADR-0003's own stated weakness: that nothing failed when someone skipped the policy layer |
| **Route-inventory test** — every registered route must appear in the authorization matrix | CI fails when a route is added without an authorization test. The control that holds under AI-generated volume |
| `no-restricted-imports` — DB and storage clients importable only in `packages/db` and `*.repository.ts`; never in `apps/dashboard` or `apps/mobile` | Client-side leakage |
| Single `withActor()` transaction helper; lint rule forbids importing the pool elsewhere | One place sets the transaction scope |
| Built-bundle CI check for storage/DB SDK symbols and secret patterns | What actually ships |
| `gitleaks` + dependency audit in CI | Committed credentials |
| Production provider accounts never connected to agent tooling | The MCP violation above |

## Testing strategy

- **Authorization matrix**: every role × resource × operation × (own / same clinic / other
  clinic), as fast unit tests over pure functions, run on every commit.
- **Cross-clinic assertion**: a test that no query returns rows across a `clinic_id`
  boundary.
- **Negative tests authored by the second agent**, not by the author of the code — tests
  written by the implementer inherit the implementer's blind spots.
- **404/403 indistinguishability**: "not found" and "not yours" must be byte-identical, or
  the difference is a patient-existence oracle.
- **Route-inventory test** as above.
- **Human penetration test focused on object-level authorization** before real patients.

## Consequences

**Advantages.** One place to answer "who can read this patient's weight series?", and one
tired person can find it by grep. The full authorization matrix runs as millisecond unit
tests rather than slow integration tests, so it is actually run. Every clinical access is
auditable because every clinical access traverses code we control. No credential exists that
reads more than an Actor may read, so there is no single catastrophic key to leak. Adding a
role is configuration. Multi-clinic isolation has exactly one enforcement point.

**Disadvantages.** Document bytes flow through the API, which consumes a connection for the
duration (trigger to revisit named in document 11 §3.6). Every caller loads the Actor's full
membership set even when it needs one field. Analytics is less convenient by design. And the
rule requires permanent discipline: the day someone adds a repository call that skips the
policy layer, the enforcement mechanisms above are what fail the build — which is why they,
not this document, are the actual control.

**Failure modes.**

| Failure | Effect | Mitigation |
| --- | --- | --- |
| API unavailable | All clinical access stops | Accepted. Health checks, fast restart, and the mobile app remaining readable from its local cache |
| Policy bug grants too much | Silent over-exposure | Authorization matrix; adversarial review by the second agent; penetration test |
| Policy bug grants too little | Visible, non-damaging | Preferred direction of failure. Fail closed |
| Credentialed insider reads 300 records at 02:00 | Indistinguishable from legitimate work | **No authorization design prevents this.** Bulk-access anomaly detection over the audit table is v1 scope for exactly this reason |
| Someone adds a second path anyway | Model silently defeated | Boot assertion, lint rules, route-inventory test, quarterly review of every production credential and integration |

## Implications

**Future AI.** An AI feature is a caller, never a principal. It resolves an Actor, passes the
same policy layer, and receives a minimised, field-allowlisted context. It never holds a
database credential and never has a tool that can issue arbitrary queries. Sending patient
data to an external model is additionally a legal decision before it is an engineering one
`[LEGAL REVIEW REQUIRED]`.

**Future analytics.** Against a restored backup or replica, identifiers removed. The moment
analytics needs a production credential, this ADR is being violated and the requirement
should be re-examined instead.

**Multi-clinic.** This is where the rule pays for itself: `clinic_id` scope resolution
happens in one place. Additionally, at the multi-clinic milestone, PostgreSQL row-level
security is enabled as defence in depth — constrained to `clinic_id = current_setting('app.clinic_id')`
and **nothing else**, so that it expresses an invariant rather than becoming a second
rulebook. The `withActor()` plumbing that sets the setting exists from day one, so enabling
it is a migration rather than an audit of every query path.

**Migration.** Nothing here binds the system to a provider. Policy is application code; the
data layer is plain PostgreSQL and a plain S3 API. Moving providers does not move the
security boundary — which is itself an argument for the boundary being in application code
rather than in a vendor's row-level security engine.

## Revisit this ADR when

- Document reads sustain roughly 100× pilot volume, or single objects exceed ~100 MB
  (reopens presigned URLs, under the constraints in document 11 §3.6).
- A third party needs programmatic access — a partner clinic, a lab integration, a research
  export. The answer is expected to be a scoped surface behind the same policy layer, but it
  deserves a fresh look rather than an assumption.
- The clinic adopts an SSO identity provider, or staff exceed ~10 (reopens the two-hostname
  exposure split).
- A credentialed-insider incident occurs.
- Any regulatory finding requires an access path this ADR forbids.

Until then: **one rulebook. Any number of front doors, all opening into it.**
