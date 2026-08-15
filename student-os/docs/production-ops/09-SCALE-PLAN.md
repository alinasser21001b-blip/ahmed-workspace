# 09 — Scale Plan

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§10 Scale assumptions**: evaluate the architecture at 1,000 / 5,000 / 50,000 / 500,000 students and state which changes become necessary at each level. Constraint from the brief: **do not introduce microservices unless a concrete scaling boundary justifies them; the default remains the existing modular monolith unless evidence proves otherwise.** No tier below reaches that bar.

## 1. Method, and an honest disclaimer

**This system has never been load-tested.** No benchmark, no capacity measurement, and no production traffic data exists in this repository. Nothing below is a measured capacity figure, and this document invents none.

What it *is* built from: the specific mechanisms this audit found in the code — an unbounded table, a row lock, an uncoordinated connection pool, an in-memory store — and the scale at which each stops being harmless. That is reasoning from mechanism, which is defensible. Predicting a request-per-second ceiling would not be.

**Student counts are a proxy, not a trigger.** The real drivers are concurrent request volume, concurrent warm instance count, and cumulative data volume — none of which scale linearly with enrolment. Where that distinction changes a recommendation, it is called out.

Each item carries one of three labels:

| Label | Means |
|---|---|
| `NOT_NEEDED` | No evidence supports doing this at this tier. Doing it anyway is premature infrastructure |
| `RECOMMENDED` | Worth doing at this tier on cost/effort grounds, even without a hard forcing function |
| `TRIGGERED_BY_EVIDENCE` | A specific mechanism identified in this audit binds here. Deferring past this tier accepts a known, named failure mode |

## 2. Tier: 1,000 students — at or near current scale

Everything at this tier is a **correctness or visibility** fix, not a scaling change. That is the point: none of it gets easier by waiting, and two items get materially more expensive.

| Item | Label | Why |
|---|---|---|
| Run the restore drill | `TRIGGERED_BY_EVIDENCE` | Not scale-triggered at all. Unproven restore is a present risk, and the cost of having skipped it rises with every student whose data exists |
| `statement_timeout` on DB connections | `TRIGGERED_BY_EVIDENCE` | Config-only. Closes a real runaway-query mode that the message-send row lock (`03-MESSAGING.md` §3) can already produce today |
| Job queue + async account deletion | `TRIGGERED_BY_EVIDENCE` | **A single large account can time out today.** This is a correctness bug reachable at any scale, not a volume problem |
| Uptime, readiness alerting, log shipping | `TRIGGERED_BY_EVIDENCE` | Matters *more* at low scale, not less: fewer users means less redundancy and a higher per-incident impact, with nobody watching |
| Post-deploy readiness gate + rollback runbook | `RECOMMENDED` | Cheap pipeline and documentation work |
| CI dependency + secret scanning | `RECOMMENDED` | Configuration on a pipeline that already exists |
| Minimum admin console | `RECOMMENDED` | Driven by pilot breadth, not student count — see §6 |
| CDN-fronted media reads | `RECOMMENDED` | Pays for itself immediately and avoids a retrofit later |
| Shared-store rate limiter | `NOT_NEEDED` | Concurrent warm instances are rarely >1 at this level |
| Table partitioning | `NOT_NEEDED` | Tables are small. Partitioning is cheap now and this is not yet the moment |
| Read replicas, brokers, second host | `NOT_NEEDED` | No evidence whatsoever |
| **Microservices** | `NOT_NEEDED` | — |

**Architecture: unchanged.** Modular monolith on Netlify Functions.

**The realtime decision (`01-TARGET-ARCHITECTURE.md` §4) is live at this tier and every tier after it** — not because of scale, but because realtime does not work on the deployed host *at all*. It is a product decision about acceptable experience, and it does not get easier or harder with student count.

## 3. Tier: 5,000 students

| Item | Label | Why |
|---|---|---|
| Everything from tier 1, complete | `TRIGGERED_BY_EVIDENCE` | Carrying tier-1 debt into this tier is where it starts compounding |
| `notifications` pruning + `learning_events` / `analytics_events` retention | `TRIGGERED_BY_EVIDENCE` | Growth becomes visible in table size and autovacuum load. `notifications` multiplies rows per source event and is plausibly the fastest-growing table in the product |
| Latency / error-rate aggregation and thresholds | `RECOMMENDED` | Needed *before* the next tier, so a baseline exists to alert against |
| DB pool-saturation visibility | `RECOMMENDED` | The instrument you need to know whether the `statement_timeout` and pooled-endpoint work actually held |
| `audit_log` partitioning | `RECOMMENDED` | Cheap now, expensive as a live migration later. Never delete rows |
| Orphaned-upload sweep | `RECOMMENDED` | Storage leak grows with upload volume; the query already exists with zero callers |
| Shared-store rate limiter | `RECOMMENDED` | Concurrent warm instances become common enough that per-instance limits start meaningfully overshooting on auth endpoints |
| Read replicas, brokers, second host | `NOT_NEEDED` | Still no evidence |
| **Microservices** | `NOT_NEEDED` | — |

**Architecture: unchanged.** Still a Postgres-table job queue; still no broker.

## 4. Tier: 50,000 students — the first genuinely new infrastructure

This is where sustained concurrent warm-instance counts >1 become the normal case rather than the exception, and the in-memory and uncoordinated-state issues stop being theoretical.

| Item | Label | Why |
|---|---|---|
| Shared-store rate limiter | `TRIGGERED_BY_EVIDENCE` | Per-instance limits now overshoot by roughly the warm-instance multiple. This is an **abuse surface on auth**, which is why it leads this tier |
| Connection-pool coordination — pooled endpoint confirmed, `DATABASE_POOL_MAX` tuned | `TRIGGERED_BY_EVIDENCE` | Independent per-instance pools of up to 10 connections, uncoordinated, against a finite Neon ceiling |
| Partitioning complete (`messages`, `notifications`, `learning_events`, `analytics_events`, `audit_log`) | `TRIGGERED_BY_EVIDENCE` | Unpartitioned tables now measurably affect backup duration and index maintenance |
| CDN-fronted media reads | `TRIGGERED_BY_EVIDENCE` | Function-invocation cost scales with **view** volume. At this tier the proxy is a material and entirely avoidable cost line |
| Admin console operational | `TRIGGERED_BY_EVIDENCE` | "An engineer queries the database to suspend an account" is not a credible moderation process at this size — and per `08-SECURITY.md` §6, it is an unaudited one |
| Realtime option resolved (A/B/C) | `TRIGGERED_BY_EVIDENCE` | Deferring is a decision by default. If option B or C is chosen, the in-memory registry becomes live and needs the `LISTEN/NOTIFY` bridge its own comment already specifies |
| Read replicas | `NOT_NEEDED` | Not yet indicated |
| Dedicated broker | `NOT_NEEDED` | Postgres-polling queue still adequate absent measured contention |
| **Microservices** | `NOT_NEEDED` | See below |

**New infrastructure introduced at this tier: a shared state store (Redis or equivalent).** This is the first genuinely new infrastructure component in the entire plan, and it is justified by a specific named mechanism — the in-memory rate-limit store at `app.ts:98-105` with no `store:` option — not by the number 50,000 sounding large.

**This is a coordination change, not a decomposition.** The Fastify app still serves every route; it reads and writes shared state instead of process-local memory. No module gains an independent deployment, an independent scaling profile, or a network boundary. **Nothing here identifies a module that needs to scale independently of the rest of the application.**

## 5. Tier: 500,000 students — extrapolation, labelled as such

**No evidence in this repository speaks to this scale.** Nothing close to it has been operated. This section is reasoned from mechanism and is explicitly weaker than the tiers above. It should be re-audited against real operating data long before it is reached.

| Item | Label | Reasoning |
|---|---|---|
| Hosting-model reassessment — activate the long-running server | `TRIGGERED_BY_EVIDENCE` (conditional) | At high sustained concurrency, cold-start behavior and per-invocation billing plausibly become worse than a fleet of long-running processes that pool connections once rather than per cold start. **Same application, same modules, different host — not a decomposition.** The path is already built and CI-exercised |
| Read replicas for read-heavy paths | `RECOMMENDED` | Feeds and classroom browsing separated from the write path. A standard Postgres lever, not a departure from one relational source of truth |
| Dedicated broker-backed job queue | `RECOMMENDED` | If job volume or latency outgrows poll-interval latency or the job table contends. A different queue **backend**, same monolith |
| Message-send lock contention mitigation | `RECOMMENDED` | The `SELECT ... FOR UPDATE` on `conversations` serializes sends per conversation. Only binds for individual very-high-traffic conversations, so it is a per-conversation problem, not a global one |
| **Microservices** | `NOT_NEEDED` | — |

## 6. Two things that are not scale-triggered at all

Recorded separately because sorting them into a tier would misrepresent them:

- **The admin console** is triggered by **pilot breadth**, not student count. A 500-student pilot with real reports and real moderation needs requires it as much as a 50,000-student one. `07-ADMIN-CONTROL-PLANE.md` treats it as P0 for that reason.
- **The restore drill** is triggered by **data existing**, not by how much. It is P0 at every tier, and the cost of continued deferral rises monotonically with the amount of irreplaceable data.

## 7. Microservices: the explicit finding

**At no tier evaluated does this audit find a concrete scaling boundary justifying microservice extraction.**

Every scaling lever named above — shared state store, connection pooling, partitioning, CDN, read replicas, a broker, a long-running host — operates *within* the modular monolith. `docs/adr/0001-modular-monolith.md` remains the standing decision, and this audit found no evidence to overturn it. The module-boundary-as-service-interface design means extraction stays available without being exercised.

**What would change this conclusion**: a future, evidence-based audit finding a specific module whose measured resource profile diverges sharply from the rest of the application — realtime fan-out under real load is the most plausible candidate, if option B or C in `01-TARGET-ARCHITECTURE.md` §4 is taken and that subsystem's characteristics prove genuinely different. **That evidence does not exist today, and this document does not manufacture it in advance.**

## 8. Summary

| Tier | New infrastructure | Headline change | Microservices |
|---|---|---|---|
| 1,000 | None | Correctness and visibility: restore drill, `statement_timeout`, job queue, monitoring basics | No |
| 5,000 | None | Retention and pruning begin; metrics aggregation | No |
| 50,000 | Shared state store | Centralize rate limiting, complete partitioning, CDN media, admin console live, realtime resolved | No |
| 500,000 | Possibly: long-running host, read replicas, broker | Hosting reassessment and read scaling — *extrapolated, not evidenced* | No |
