# 05 — Monitoring / Observability

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§6 Monitoring / Observability**: uptime, API latency, 4xx/5xx rates, DB health, WebSocket health, storage failures, background-job failures, mobile crashes, structured logs, alerting.

## 1. The distinction this document exists to hold

**Structured logs are not observability.** They are the raw material observability is made from. This repository has unusually good raw material and no observability at all — nothing collects the logs, nothing computes a rate or a percentile from them, and nothing notifies a human when anything breaks.

Stated in the status vocabulary from `00-CURRENT-STATE.md`:

| | Status |
|---|---|
| Structured, redacted, correlated logs | `EXISTS_NOW` |
| Liveness and readiness endpoints | `EXISTS_NOW` |
| External uptime monitoring | **does not exist** — `RECOMMENDED` |
| Log aggregation / search | **does not exist** — `RECOMMENDED` |
| APM / error tracking | **does not exist** — `RECOMMENDED` |
| Metrics of any kind | **does not exist** — `DOCUMENTED_ONLY` in `docs/01-TECHNICAL-ARCHITECTURE.md` §9 |
| Alerting of any kind | **does not exist** — `RECOMMENDED` |
| Mobile crash reporting | **does not exist** — `RECOMMENDED` |

## 2. What exists (`EXISTS_NOW`)

**Zero external APM, error-tracking, or metrics tooling exists anywhere.** Confirmed by searching every `package.json` in the monorepo and all mobile/API source for Sentry, Datadog, New Relic, Honeycomb, Logtail, Axiom, Grafana, Prometheus, and OpenTelemetry: **zero matches.**

What is real:

- **Structured JSON logs** — pino (`logger.ts`), JSON in production, pretty in development, with centrally configured redaction scrubbing `password`, `passwordHash`, `refreshToken`, `accessToken`, `token_hash`, `AI_API_KEY`, `JWT_SECRET`, and auth headers/cookies from every line (`logger.ts:12-26`).
- **One access-log line per request** carrying `method`, `route`, `status`, `durationMs`, `actorId` — and a **correlation id** (`requestId`, minted or echoed per request, attached to every child logger and every error envelope, `request-context.ts:21-51`). `actorId` rather than raw identity is the right choice: requests correlate to a user without logging PII.
- **Liveness / readiness** (`health.routes.ts`) — `/health` does not touch the database; `/health/ready` runs `SELECT 1` *and* a schema-currency check, returning `503` if either fails. Genuinely useful signal, and nothing currently polls it.

This is real, queryable raw material — *if* something ships it to an aggregator. Nothing in this repository does. Logs go to stdout and are captured by whatever the platform does with function logs (Netlify's own log viewer, by default). Retention and searchability there are `NEEDS LIVE VERIFICATION`.

**`docs/01-TECHNICAL-ARCHITECTURE.md` §9 claims "Reserved metric surfaces: AI latency/errors, realtime connection errors, DB pool saturation."** No such metrics are emitted anywhere in the codebase. This is Phase-0 aspirational text, recorded as `DOCUMENTATION_DRIFT` #2 in `00-CURRENT-STATE.md` §10 — it must not be read as capability.

**Zero mobile crash reporting.** No `ErrorBoundary` component, no `app/+error.tsx` or equivalent, no crash-reporting SDK anywhere in `apps/mobile`. An unhandled render error in production shows the platform's default crash with **no report reaching anyone**.

## 3. Gap assessment against the brief's checklist

| Requirement | Raw material today | What is missing |
|---|---|---|
| **Uptime** | `/health` exists and is a valid probe target | Nothing polls it. No external monitor, no alert |
| **API latency** | `durationMs` on every request line | No aggregation — no p50/p95/p99, no trend, no dashboard |
| **4xx/5xx rates** | `status` on every request line | No aggregation into an error rate, no threshold, no alert |
| **DB health** | `/health/ready` checks reachability **and** schema currency, on demand | Nothing polls it continuously. No visibility into pool saturation — directly relevant to the uncoordinated-pool and missing-`statement_timeout` risks in `02-DATA-STORAGE.md` §4 |
| **WebSocket health** | — | Nothing. Note the honest framing: on the deployed Netlify host **realtime does not work at all** (`03-MESSAGING.md` §2), so the useful metric today is not "connection count" but *whether the client's endless retry loop is burning battery and network against an endpoint that can never succeed*. Real WebSocket health metrics only become meaningful if option B or C in `01-TARGET-ARCHITECTURE.md` §4 is chosen |
| **Storage failures** | — | Blobs read/write failures, signed-URL verification failures, and upload rejections are not counted or alerted |
| **Background-job failures** | — | No queue exists yet (`01-TARGET-ARCHITECTURE.md` §5). This is a *design-it-in* requirement, not a retrofit |
| **Mobile crashes** | — | No SDK, no error boundary, no reports |
| **Structured logs** | **Good** — redacted, correlated, per-request | Not shipped anywhere searchable |
| **Alerting** | — | **Nothing notifies any human about anything** |

## 4. Recommendation: route what already exists before building a platform

The fastest path to real observability here is not more instrumentation code — the instrumentation is already good. It is **getting the existing signal to a place a human can search, and to a channel that wakes someone up.** That ordering also keeps the work consistent with the brief's no-infrastructure-ahead-of-evidence constraint: the P0 items are configuration and routing, not application rewrites.

**P0 — closes the "nobody would know" gap**

1. **External uptime check on `/health`, with alerting.** Third-party pinger, short interval, notification on failure. The endpoint exists and was designed for exactly this. Configuration, not infrastructure.
2. **Separate standing check on `/health/ready`.** Liveness passing while readiness fails — app up, database unreachable or schema behind — is a distinct and more actionable signal than "the app is down". Both endpoints already return the right thing. Note this is the *standing* check; the *post-deploy* gate on the same endpoint is `01-TARGET-ARCHITECTURE.md` §6.
3. **Ship logs to a searchable aggregator.** Because logging is already structured JSON with redaction enforced at the source, this is close to drop-in. **One constraint** (`08-SECURITY.md` §2): verify the destination does not re-capture raw request bodies or headers at ingestion — the application's redaction guarantees only cover what the application logs.

**P1 — turns logs into metrics**

4. Aggregate `durationMs` and `status` into latency percentiles and error rates. Most log platforms do this natively over structured JSON with no new instrumentation code.
5. Alert thresholds on 5xx rate and p95 latency — **after** observing a baseline. A threshold set before you know normal is a pager that cries wolf.
6. Database pool-saturation visibility, given `02-DATA-STORAGE.md` §4's uncoordinated pools. Needed to know whether steps 1–3 there actually worked.

**P2 — dependent on other work landing**

7. **Background-job failure and retry monitoring.** Depends on the queue existing. `01-TARGET-ARCHITECTURE.md` §5 already specifies `status`/`attempts`/`last_error` in the job table's first migration precisely so this is a query rather than a schema change.
8. **Storage failure counters** — extend existing structured logging to storage operations, then aggregate. No new tool.
9. **Mobile crash reporting.** A crash-reporting SDK plus an error boundary. **This is a client dependency and configuration change, not a UI or design-system change** — it therefore does not conflict with the frozen mobile handoff, and can be picked up as a separate workstream whenever that surface is unfrozen.

## 5. Summary

| Area | Status | Priority |
|---|---|---|
| Structured, redacted, correlated logs | `EXISTS_NOW` | — |
| Liveness / readiness endpoints | `EXISTS_NOW` | — |
| External uptime monitoring + alerting | `RECOMMENDED` | **P0** |
| Standing readiness check + alerting | `RECOMMENDED` | **P0** |
| Log aggregation / search | `RECOMMENDED` | **P0** |
| Latency and error-rate metrics | `RECOMMENDED` | P1 |
| DB pool-saturation visibility | `RECOMMENDED` | P1 |
| Background-job failure monitoring | `RECOMMENDED`, blocked on the queue | P2 |
| Storage failure monitoring | `RECOMMENDED` | P2 |
| Mobile crash reporting | `RECOMMENDED` | P2 |
| "Reserved metric surfaces" in `01-TECHNICAL-ARCHITECTURE.md` §9 | `DOCUMENTED_ONLY` — not capability | `DOCUMENTATION_DRIFT` #2 |

**`OBSERVABILITY_READY = NO`** — carried into `10-IMPLEMENTATION-PLAN.md`. Good logs, zero monitoring, zero alerting: today nobody would be notified if the product went down.
