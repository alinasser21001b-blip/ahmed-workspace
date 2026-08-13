# Technical Architecture

> Status: **Approved for Phase 0** (Constitution §89.B).

## 1. Shape

```
┌───────────────────────────────────────────────────────────┐
│  apps/mobile — Expo (iOS / Android / Web via RN-Web)      │
│  design system · navigation · screens · api client        │
└────────────────────────┬──────────────────────────────────┘
                         │ HTTPS  (typed contracts)
┌────────────────────────▼──────────────────────────────────┐
│  apps/api — Fastify modular monolith (TypeScript, ESM)    │
│                                                            │
│  http layer: request-id · auth · rate limit · validation   │
│  ─────────────────────────────────────────────────────     │
│  modules/  auth · users · academic · social · communities  │
│            groups · messaging · classrooms · content       │
│            quizzes · learning · live · notifications       │
│            search · ai · moderation · admin · analytics    │
│  each: routes / service / repository / policy / tests      │
│  ─────────────────────────────────────────────────────     │
│  platform/  db · logger · errors · config · events         │
└───┬─────────────┬──────────────┬───────────────┬──────────┘
    │             │              │               │
┌───▼────┐  ┌─────▼─────┐  ┌─────▼──────┐  ┌─────▼────────┐
│Postgres│  │ Realtime  │  │  Object    │  │  AI Gateway  │
│  16    │  │ (WS hub)  │  │  Storage   │  │  (in-proc    │
│        │  │           │  │ (S3-compat)│  │   module)    │
└────────┘  └───────────┘  └────────────┘  └──────┬───────┘
                                                   │
                                            ┌──────▼───────┐
                                            │ LLM provider │
                                            └──────────────┘
```

### Shared packages

| Package | Purpose | Depends on |
| --- | --- | --- |
| `@sos/contracts` | Zod schemas + inferred types for every request/response. **The API contract is code, not prose.** | — |
| `@sos/core` | Pure domain logic: authorization policies, learning calculations, message state machine, ranking. **No I/O, fully unit-testable.** | `@sos/contracts` |

`@sos/core` having zero I/O dependencies is what makes the security rules
(§81) testable as fast unit tests rather than slow integration tests.

## 2. Stack decisions

| Layer | Choice | Why (and what was rejected) |
| --- | --- | --- |
| Language | TypeScript everywhere, ESM, `strict` | One type system across client/server/shared contracts. |
| API framework | **Fastify 5** | Schema-first, fast, first-class hooks for request-id/auth. Rejected Express (no native schema/validation story), NestJS (DI ceremony not justified at this size). |
| Validation | **Zod 4** + `fastify-type-provider-zod` | Same schema validates the request *and* generates the client type. Never trust client input (§47). |
| DB | **PostgreSQL 16**, `pg` driver, hand-written SQL | Relational data with heavy graph-ish joins. Rejected an ORM: the queries that matter here (feed ranking, permission filters) are ones ORMs obscure. Repositories keep SQL contained. |
| Migrations | Numbered `.sql` files + tiny runner with advisory lock | Transparent, reviewable, no framework lock-in. |
| Auth | Argon2id passwords, opaque refresh tokens (hashed at rest) + short-lived JWT access | Rejected long-lived JWTs (unrevocable) and custom crypto (§15: *do not build custom cryptographic protocols*). |
| Realtime | `ws` hub inside the monolith, Postgres `LISTEN/NOTIFY` fan-out | 100 users needs no Kafka. The hub is behind an interface so it can move to a managed service without touching call sites. |
| Storage | S3-compatible + signed URLs | Media never in DB rows (§49). |
| Live video | **External provider** behind `LiveProvider` interface | §23: do not build video infrastructure. |
| Client | **Expo + Expo Router** | One codebase → iOS, Android, and Web. Web target means CI can actually render and screenshot the UI. |
| i18n | `i18n/` catalogs, Arabic default, RTL-aware primitives | §62: no hardcoded strings. |
| Tests | Vitest (unit + integration against real Postgres), Playwright (E2E) | Integration tests hit a real DB — permission bugs do not reproduce against mocks. |
| Logging | `pino`, structured, request-scoped | §82. |

## 3. Module contract

Every module in `apps/api/src/modules/<name>/` has this shape and no other:

```
<name>/
  <name>.routes.ts      HTTP surface. Declares auth + schema. No business logic.
  <name>.service.ts     Business logic + orchestration. Calls policies.
  <name>.repository.ts  SQL only. Returns rows. No business decisions.
  <name>.policy.ts      Thin adapter to @sos/core policies (optional).
  <name>.types.ts       Internal types (public types live in @sos/contracts).
  __tests__/            Unit + integration.
```

**Rules enforced in review:**
1. A module may import another module's **service**, never its **repository**.
2. Repositories never call services (no upward calls).
3. No `utils.ts` grab-bags (§46). A helper lives with its domain or in `@sos/core`.
4. Route handlers do not touch the database directly.
5. Every route declares `auth` explicitly — there is no implicit-public default.

## 4. Request lifecycle

```
request
  → requestId (header or generated, attached to logger + error envelope)
  → rate limit  (per-IP, tightened per-route for auth/AI/upload)
  → authenticate (Bearer access token → actor, or anonymous)
  → validate (Zod: params, query, body — rejects unknown keys)
  → route handler → service
        → policy check  ← the single authorization layer
        → repository → Postgres
  → serialize (Zod response schema)
  → error handler (AppError → sanitized envelope; unknown → 500 + logged)
```

### Error envelope

Every non-2xx response, without exception:

```jsonc
{
  "error": {
    "code": "FORBIDDEN",          // stable machine-readable enum
    "message": "…",               // safe for display, never leaks internals
    "details": [ … ],             // optional, validation issues only
    "requestId": "01J…"           // correlates to server logs
  }
}
```

Unknown exceptions are logged with full stack and returned as a generic
`INTERNAL` — error sanitization is a security control (§50), not politeness.

## 5. Authorization model

Two layers, both required:

1. **Policy (`@sos/core/policy`)** — pure functions:
   `canViewContent`, `canEditContent`, `canDeleteContent`, `canMessage`,
   `canAccessClassroom`, `canAccessGroup`, `canAccessResource`,
   `canModerate`, `visibilityScopesFor(actor)`.
2. **Query-level filtering** — list endpoints never fetch-then-filter. They
   push the actor's visibility scopes into the SQL `WHERE` clause. Fetch-then-
   filter leaks row counts and paginates incorrectly.

The AI retrieval pipeline calls **the same** `visibilityScopesFor(actor)` to
build its retrieval filter. There is no privileged AI path (§29).

Blocking is bidirectional and applied at the query level: a block hides
profiles, content, mentions, and messaging in both directions (§40).

## 6. Realtime architecture

Realtime is used only where it earns its keep (§48):

| Realtime | Standard request/response |
| --- | --- |
| chat messages, typing, presence, group events, live-session events, in-app notification pings | feed, profiles, lectures, resources, analytics, search |

Transport: WebSocket, authenticated with the same access token at handshake.
Client subscribes to topics (`conversation:<id>`, `user:<id>`); server
authorizes each subscription through the same policy layer.

**Message delivery contract** (§15, §52):
- Client generates a `client_message_id` (UUIDv4) → server upserts on
  `(conversation_id, client_message_id)`. Retries are idempotent, never duplicates.
- Message state machine (in `@sos/core`, unit-tested):
  `queued → sending → sent → delivered → read`, with `failed` reachable from
  `sending` and retryable back to `sending`. No other transitions are legal.
- Ordering: server assigns a monotonic `seq` per conversation. Clients sort by
  `seq`, never by client clock.
- Reconnect: client sends last known `seq`; server replays the gap.

## 7. AI architecture

AI is an **application layer**, never scattered LLM calls (§26).

```
client → POST /ai/... (no provider keys ever reach the client)
   → authenticate
   → authorize (actor's visibility scopes computed ONCE, here)
   → intent detection
   → context retrieval  ← filtered by those scopes, no exceptions
   → RAG chunk retrieval
   → prompt assembly (system prompt encodes safety posture §30)
   → LLM (provider behind an interface)
   → validation: structured output + citation validator
        · every citation must resolve to a chunk actually in the retrieved set
        · unresolvable citation ⇒ dropped, response flagged, never fabricated
   → persist ai_session / ai_message / ai_sources (model, latency, tokens, error)
   → structured response with sources
```

Safety posture baked into the system prompt and validated: no clinical
authority claims, explicit uncertainty, source-vs-general-knowledge distinction,
hint-first for quiz material (anti-cheating), full auditability via `ai_messages`.

## 8. Environments & configuration

`packages/config` loads and **validates** environment with Zod at boot. A
missing or malformed variable is a startup crash, never a runtime surprise.
Secrets are never bundled into the client; the mobile app receives only
`EXPO_PUBLIC_*` values.

## 9. Observability

- Structured JSON logs (`pino`), one line per request with `requestId`,
  `actorId`, route, status, duration.
- Request IDs propagate to the client in the error envelope, so a user-reported
  bug maps to an exact log line.
- Health endpoints: `/health` (liveness), `/health/ready` (DB reachable +
  migrations current).
- Reserved metric surfaces: AI latency/errors, realtime connection errors, DB
  pool saturation.

## 10. Deployment

Multi-stage Dockerfile (build → prune → distroless-ish runtime), GitHub Actions
running typecheck → lint → unit → integration (real Postgres service) → build.
Migrations run as a separate step before the app starts, guarded by an advisory
lock so concurrent instances cannot race.

## 11. Scaling path (100 → 1M)

Deliberately deferred, but the seams exist today:

| Pressure point | Today | Change when needed |
| --- | --- | --- |
| Realtime fan-out | in-process hub | extract hub; Redis/managed pub-sub |
| Feed ranking | SQL ranking function | precomputed feed tables + worker |
| Search | Postgres FTS + trigram | dedicated search cluster |
| Embeddings | `pgvector` in the same DB | dedicated vector store |
| Media processing | queued job table | job queue + transcoding workers |
| Modules | monolith | extract a module behind its service interface |

No microservices, no Kubernetes, no distributed anything until a real limit is
measured (§4.6, §86).
