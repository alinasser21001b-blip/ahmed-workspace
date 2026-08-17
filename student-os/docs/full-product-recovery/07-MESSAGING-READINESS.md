# 07 — Messaging Readiness

**Scope.** Messaging in Student OS, split into two independently-assessable units exactly as Section 14 of the recovery task requires:

- **MESSAGING_CORE** — everything a student needs to read and send messages, over plain HTTP, with no socket involved at any point.
- **REALTIME_ENHANCEMENT** — the WebSocket channel that makes delivery arrive by itself rather than on a refresh.

The split is not a reporting convenience. It is the architecture the repository already commits to: `apps/api/src/modules/messaging/messaging.routes.ts:22-29` states the design as "Every write is HTTP, including sending. The realtime socket is a notification channel, not a command channel." This document assesses the two units against that stated design.

**Evidence base.** All status claims below are taken from the Phase A forensic evidence file, areas `messaging` and `api`. Paths are given as the evidence gives them, relative to the `student-os/` workspace root. Where this document states a fact that the audit did not record, it says so and cites the file and line that establishes it.

**Status vocabulary** used here, unchanged: `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`, `PARTIAL`, `BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`, `MISSING`, `DEAD_CODE`, `PREVIEW_ONLY`.

---

## 1. Verdict in one paragraph

MESSAGING_CORE is `CONNECTED_AND_WORKING` with one specific, identified gap. Conversation listing, opening a conversation, loading history by sequence, sending through an idempotent HTTP outbox, retrying a failed send, marking read, and permission-gated composing are all wired end to end from the two chat screens to the Fastify routes, and the integration tests exercise the send/history/read loop with no socket present at all. The gap is that `POST /v1/conversations` — the endpoint that creates a conversation — has no UI call path, so a student cannot start a new direct conversation from the shipped app. REALTIME_ENHANCEMENT is complete on both the server and the client but cannot run on the current production host: `CAN_CURRENT_HOST_RUN_WS = NO`, because a Netlify Function is invoked per request and cannot hold a connection open. Chat is **not** hidden, disabled, or feature-flagged off because of this; both chat screens carry a permanent, translated banner stating that live delivery is unavailable while everything HTTP continues to work.

---

## 2. MESSAGING_CORE

### 2.1 Capability table

| # | Capability | Status | Primary evidence |
|---|---|---|---|
| 1 | Conversation list | `CONNECTED_AND_WORKING` | `messaging.routes.ts:40`; `app/(tabs)/chat.tsx:45` |
| 2 | Open a conversation | `CONNECTED_AND_WORKING` | `messaging.routes.ts:70`; `app/chat/[id].tsx:67` |
| 3 | Load history | `CONNECTED_AND_WORKING` | `messaging.routes.ts:85`; `app/chat/[id].tsx:73` |
| 4 | Pagination (by seq) | `CONNECTED_AND_WORKING` | `messaging.routes.ts:85`; `app/chat/[id].tsx:201` |
| 5 | Send (idempotent HTTP outbox) | `CONNECTED_AND_WORKING` | `messaging.routes.ts:104`; `src/state/outbox.ts:136-149` |
| 6 | Retry a failed send | `CONNECTED_AND_WORKING` | `src/state/outbox.ts:150-169` |
| 7 | Read state | `CONNECTED_AND_WORKING` | `messaging.routes.ts:137`; `app/chat/[id].tsx:94` |
| 8 | Blocking and send permissions | `CONNECTED_AND_WORKING` | `conversations.service.ts:246`, `:349`; `app/chat/[id].tsx:356-432` |
| 9 | Message state machine | `CONNECTED_AND_WORKING` | `src/state/outbox.ts:111-118`, `:150-169` |
| 10 | **Start a new conversation** | **`BACKEND_ONLY`** | `messaging.routes.ts:55-68`; no caller in `app/**` or `src/**` |
| 11 | Edit / delete a message | `BACKEND_ONLY` | `messaging.routes.ts:157`, `:173` |

### 2.2 Conversation list — `CONNECTED_AND_WORKING`

`GET /v1/conversations` exists at `apps/api/src/modules/messaging/messaging.routes.ts:40`, registered under `/v1` at `apps/api/src/http/app.ts:136`, behind `requireAuth`. The chat tab calls it directly over plain HTTP at `apps/mobile/app/(tabs)/chat.tsx:45` (`api.get('/v1/conversations?limit=30')`), with pull-to-refresh at `apps/mobile/app/(tabs)/chat.tsx:107-113` and rows pushing `/chat/[id]` at `apps/mobile/app/(tabs)/chat.tsx:126`. The list additionally reloads when a realtime frame arrives (`apps/mobile/app/(tabs)/chat.tsx:59`), but the audit records that as a bonus on top of the HTTP load rather than the load path itself.

### 2.3 Open a conversation — `CONNECTED_AND_WORKING`

`GET /v1/conversations/:conversationId` exists at `apps/api/src/modules/messaging/messaging.routes.ts:70` and the thread screen calls it at `apps/mobile/app/chat/[id].tsx:67`. The response carries a `viewer` block including `canSend`, assembled at `apps/api/src/modules/messaging/conversations.service.ts:134-140`.

### 2.4 Load history and pagination — `CONNECTED_AND_WORKING`

`GET /v1/conversations/:conversationId/messages` exists at `apps/api/src/modules/messaging/messaging.routes.ts:85` and is paginated by sequence rather than by timestamp; the route's own description states the reason — "two messages can share a millisecond and none can share a seq. `beforeSeq` scrolls backwards; `afterSeq` replays a reconnect gap" (`apps/api/src/modules/messaging/messaging.routes.ts:92-94`, confirmed by direct read). The client loads the first page at `apps/mobile/app/chat/[id].tsx:73` (`limit=50`) and fetches older pages with `beforeSeq=` at `apps/mobile/app/chat/[id].tsx:201`. HTTP pages and realtime frames are folded by the same merge function at `apps/mobile/app/chat/[id].tsx:462-466`, so history rendering does not depend on which route a message arrived by. Dense, monotonic sequence numbering is asserted in the integration tests at `apps/api/test/messaging.integration.test.ts:88-112`.

### 2.5 Send — idempotent HTTP outbox — `CONNECTED_AND_WORKING`

`POST /v1/conversations/:conversationId/messages` exists at `apps/api/src/modules/messaging/messaging.routes.ts:104` and is idempotent on `clientMessageId`; a repeat after a dropped response returns the stored message with `deduplicated: true`, the same id and the same seq, and the dedup path is at `apps/api/src/modules/messaging/messaging.routes.ts:110-125`. Idempotency is backed by a database uniqueness constraint on `(conversation_id, client_message_id)` (`migrations/0004_messaging.sql`, cited in the `api` area evidence).

On the client, the composer does not call the API directly. It enqueues into the Outbox at `apps/mobile/app/chat/[id].tsx:189`, and the Outbox performs the HTTP POST at `apps/mobile/src/state/outbox.ts:136-145`. Exactly one send is in flight per conversation, and reconciliation is driven by `clientMessageId` from the HTTP response itself rather than from a socket frame (`apps/mobile/src/state/outbox.ts:111-118`, `:149`).

This is the load-bearing property of the whole design, and the audit states it explicitly: send and load work with no socket at all. The evidence for that is `apps/mobile/src/state/outbox.ts:136-149` (send is `api.post`; reconcile happens from the HTTP response) together with the code comment at `apps/mobile/app/(tabs)/chat.tsx:26-30`: "On the current production host the socket never opens at all... sending and loading still work."

One honest qualification recorded by the audit: without a socket there is no HTTP polling loop, so *receiving* a new message requires a manual refresh — pull-to-refresh on the list, or re-opening / `loadOlder` on the thread. "No socket" therefore degrades to manual-refresh delivery, not to automatic delivery by another route.

### 2.6 Retry — `CONNECTED_AND_WORKING`

A failed send moves to `failed` and is re-queued on a jittered exponential backoff at `apps/mobile/src/state/outbox.ts:150-169`. Direct read of the same file confirms the mechanics: the delay is `retryDelayMs(attempts) * (0.75 + Math.random() * 0.5)` (`apps/mobile/src/state/outbox.ts:155`), retries are bounded by `shouldRetry` (`apps/mobile/src/state/outbox.ts:154`), and draining of the conversation stops while an entry is stuck so that messages cannot be delivered out of the order they were typed in (`apps/mobile/src/state/outbox.ts:166-168`). The retry bound and backoff curve live in the shared package: `shouldRetry(state, attempts, maxAttempts = 5)` and `retryDelayMs(attempts, baseMs = 1000, capMs = 30_000)` at `packages/core/src/messaging/message-state.ts:89` and `:94`. Because the server is idempotent on `clientMessageId`, a retry costs one row at worst — the two halves are designed against each other.

### 2.7 Read state — `CONNECTED_AND_WORKING`

`PUT /v1/conversations/:conversationId/read` exists at `apps/api/src/modules/messaging/messaging.routes.ts:137` and is monotonic and clamped to the conversation head, so a late receipt cannot rewind the position and a client cannot mark itself read past messages it has never seen (`apps/api/src/modules/messaging/messaging.routes.ts:143-145`, confirmed by direct read). The thread screen calls it at `apps/mobile/app/chat/[id].tsx:94` and marks read continuously at `apps/mobile/app/chat/[id].tsx:112-116`. Read and delivery positions are stored as monotonic columns with a `CHECK` constraint (`migrations/0010_messaging_delivery.sql:23-31`). The `message_receipts` table exists but is explicitly reserved and unused (`migrations/0010_messaging_delivery.sql:17-20`); per-recipient receipts are therefore `DEAD_CODE` at the schema level, not a shipped capability.

### 2.8 Blocking and send permissions — `CONNECTED_AND_WORKING`

Permission to write to a conversation is decided by the shared policy function `canSendMessage` in `packages/core/src/policy/conversation.policy.ts:107`, called by the send path at `apps/api/src/modules/messaging/conversations.service.ts:349` and surfaced to the client as `viewer.canSend` at `apps/api/src/modules/messaging/conversations.service.ts:137`. Conversation creation applies `canMessage` and distinguishes the two failure modes deliberately: a blocked target returns 404 so its existence is not confirmed, while a known-but-forbidden target returns 403 (`apps/api/src/modules/messaging/conversations.service.ts:240-249`). Direct messages also pass a moderation gate on the private surface, with the reasoning recorded in the code at `apps/api/src/modules/messaging/conversations.service.ts:352-360`.

On the client, the composer is **removed rather than disabled** when the viewer may not send, and the reason is displayed in its place (`apps/mobile/app/chat/[id].tsx:356-432`, with the read-only reason rendered at `apps/mobile/app/chat/[id].tsx:426-431`). The audit is explicit that composer removal is driven by `conversation.viewer.canSend` — a permissions fact — and never by connection status.

Blocking itself is wired end to end elsewhere in the product (`social` area: block / unblock / blocked list, `CONNECTED_AND_WORKING`). Mutes are `BACKEND_ONLY`: `PUT` and `DELETE /v1/mutes` exist at `apps/api/src/modules/social/social.routes.ts:149` and `:166` with no client call site, and the `mute_target` enum covers `conversation` (`migrations/0003_social_and_content.sql:73`). A student therefore cannot mute a conversation from the shipped app.

### 2.9 Message state — `CONNECTED_AND_WORKING`

The client-side delivery state machine is a shared, dependency-free module: `packages/core/src/messaging/message-state.ts:13-25` defines `queued | sending | sent | delivered | read | failed`, `:27-38` defines the legal transitions, and `:61` (`advance`) refuses illegal ones while treating a late lower-rank receipt as a no-op. The Outbox drives it: `queued` on enqueue (`apps/mobile/src/state/outbox.ts:93`), `sending` on dispatch, `sent` on reconcile (`apps/mobile/src/state/outbox.ts:111-118`), `failed` on a rejected POST with re-entry to `queued` after backoff (`apps/mobile/src/state/outbox.ts:150-169`). `delivered` and `read` are the states that depend on the socket and on `message_receipts`; given that receipts are reserved-unused (§2.7) and the socket does not run in production (§3), the practical shipped range on the current host is `queued → sending → sent | failed`. This last inference is drawn from the cited evidence rather than stated by the audit.

### 2.10 The one CORE gap — starting a new conversation — `BACKEND_ONLY`

**This is the single broken link in MESSAGING_CORE, and it is worth stating plainly: a student with a brand-new account cannot start a direct conversation with anyone from the shipped app.**

- The endpoint exists and works: `POST /v1/conversations` at `apps/api/src/modules/messaging/messaging.routes.ts:55-68`, with find-or-create semantics and full block/permission handling at `apps/api/src/modules/messaging/conversations.service.ts:240-256`.
- The only callers are end-to-end scripts: `apps/mobile/e2e/messaging.mjs:108`, `apps/mobile/e2e/rtl-audit.mjs:213`, and `apps/mobile/e2e/smoke.mjs`. A grep of `apps/mobile/app/**` and `apps/mobile/src/**` finds no screen calling `POST /v1/conversations`.
- The apparent escape hatch dead-ends. The chat empty state routes to `/search` (`apps/mobile/app/(tabs)/chat.tsx:118`); search rows route to `/profile/:handle` (`apps/mobile/app/search.tsx:208`); and `apps/mobile/app/profile/[handle].tsx` contains no conversation or message action at all (the audit records zero grep matches for `conversation|message|/chat` in that file). The profile screen offers Follow, Block and Report.

The consequence is precise. A student can list, open, read, page through, send into and mark read any conversation that already exists server-side — every capability in §2.2 rows 1 to 9 is genuinely working — but there is no button anywhere in the UI that brings a new direct conversation into existence. The classification is `BACKEND_ONLY` because the server half is complete and only the call path is missing.

### 2.11 Message edit and delete — `BACKEND_ONLY`

`PATCH /v1/messages/:messageId` (`apps/api/src/modules/messaging/messaging.routes.ts:157`) and `DELETE /v1/messages/:messageId` (`apps/api/src/modules/messaging/messaging.routes.ts:173`) exist and publish realtime frames on success (`apps/api/src/modules/messaging/conversations.service.ts:516`, `:549`), but the `api` area evidence records that neither has a client call site.

---

## 3. REALTIME_ENHANCEMENT

### 3.1 Capability table

| # | Capability | Status | Primary evidence |
|---|---|---|---|
| 1 | WebSocket server | `CONNECTED_AND_WORKING` (long-lived host) | `realtime.routes.ts:50`; `app.ts:121-123`, `:142` |
| 2 | WebSocket client | `CONNECTED_AND_WORKING` (client half fully wired) | `src/state/realtime.tsx:102-103`, `:115-122` |
| 3 | **Can the production host hold a socket?** | **`BLOCKED_BY_DEPLOYMENT` — `CAN_CURRENT_HOST_RUN_WS = NO`** | `netlify/api/handler.mts:34-39`, `:295-303` |
| 4 | Socket in preview builds | `PREVIEW_ONLY` (never opened) | `src/state/realtime.tsx:76-89` |
| 5 | Is Chat hidden because of WS? | **No** — `app/(tabs)/_layout.tsx:132-138` | banner instead of removal |

The `messaging` area evidence classifies row 3 as `BLOCKED_BY_ENVIRONMENT`. That term is outside the status vocabulary this document is required to use; the vocabulary term that matches the recorded fact — the code is complete and the deployment target cannot execute it — is `BLOCKED_BY_DEPLOYMENT`, and that is the term used here. No fact has been changed.

### 3.2 The server is complete — `CONNECTED_AND_WORKING`

The WebSocket server is real, not a stub:

- Library `@fastify/websocket ^11.3.0` (`apps/api/package.json:26`), registered with a 16 KB max payload at `apps/api/src/http/app.ts:121-123`.
- Route `WS /v1/realtime?token=` at `apps/api/src/modules/messaging/realtime.routes.ts:50`, registered at `apps/api/src/http/app.ts:142`.
- The handshake re-verifies the token signature, session revocation and actor status — the same checks REST performs (`apps/api/src/modules/messaging/realtime.routes.ts:59-78`).
- Accepted client frames are `subscribe`, `unsubscribe`, `resync`, `typing`, `ping` only. No frame writes to the database.
- `resync` replays the gap after a client-supplied `lastSeq` (`apps/api/src/modules/messaging/realtime.routes.ts:136-154`); typing is in-memory with a 5-second TTL (`apps/api/src/modules/messaging/realtime.routes.ts:36-39`, `:156-199`).
- Fan-out is published **after commit**, from the service layer: `apps/api/src/modules/messaging/conversations.service.ts:437-442` for sends, `:478`, `:516`, `:549` for read, edit and delete.
- The long-lived entrypoint that this all requires exists: `apps/api/src/index.ts:35` (`app.listen`).

Fan-out is a single-process `Map` (`apps/api/src/modules/messaging/realtime.ts:48-99`), and the file states at `apps/api/src/modules/messaging/realtime.ts:22-26` that there is no broker and that a Postgres `LISTEN/NOTIFY` bridge is the named future step behind the same `publish(userIds, frame)` signature. The status `CONNECTED_AND_WORKING` therefore applies to the deployment shape where the API runs as a long-lived Fastify process (`pnpm dev`, Docker, or any comparable host), which is how the audit qualifies it.

### 3.3 The client is complete — `CONNECTED_AND_WORKING` (client half)

`apps/mobile/src/state/realtime.tsx` connects to `ws(s)://<API_BASE_URL>/v1/realtime?token=<accessToken>` and only when signed in (`apps/mobile/src/state/realtime.tsx:102-103`). The provider is mounted globally at `apps/mobile/app/_layout.tsx:79`. On open it re-sends `subscribe` for every tracked conversation and then resyncs from the per-conversation high-water seq, in that order (`apps/mobile/src/state/realtime.tsx:115-122`), and flushes the Outbox (`apps/mobile/src/state/realtime.tsx:125`). Because subscriptions survive reconnects and the high-water seq drives resync, a dropped socket is a latency problem rather than a data-loss one.

`CONNECTED_AND_WORKING` here means the client half is fully wired. Against the Netlify production host it correctly cycles `connecting → offline`, which is the designed behaviour, not a defect in the client.

### 3.4 The infinite jittered backoff

The reconnect policy recorded by the audit is unlimited, jittered exponential backoff: base 1 second doubling to a 30-second cap, multiplied by a `0.75`–`1.25` jitter factor to avoid a thundering herd on campus wifi, with the attempt counter reset to zero on open.

- Constants: `apps/mobile/src/state/realtime.tsx:31-32` (`RECONNECT_BASE_MS = 1000`, `RECONNECT_CAP_MS = 30_000`).
- Scheduling: `apps/mobile/src/state/realtime.tsx:148-159` — `delay = min(30s, 1s * 2^attempts) * (0.75 + random * 0.5)`, unlimited attempts.
- Reset on open: `apps/mobile/src/state/realtime.tsx:107`.
- Triggers: `apps/mobile/src/state/realtime.tsx:161-162` (`onclose` schedules a reconnect; `onerror` closes, which then schedules one).

On a host that cannot upgrade the connection, this loop never terminates and the status never leaves `offline`. See §3.8 for a build-time flag now present in the repository that short-circuits this loop before the socket is constructed; the flag changes when the loop runs, not what the loop does.

### 3.5 `CAN_CURRENT_HOST_RUN_WS = NO`

The verdict is `NO`, and the runtime reason is stated verbatim in the deployment adapter, `netlify/api/handler.mts:34-39`:

> WHAT DOES NOT WORK HERE, and is not made to look like it does: the realtime WebSocket at `/v1/realtime`. A function is invoked per request and cannot hold a connection open, so the upgrade fails, the client's backoff takes over and messaging falls back to its HTTP path — messages send and load, they just do not arrive by themselves. Fixing that means a host that can hold a socket, not a change to this file.

The mechanism behind that statement:

- Every request is served through `app.inject()` — Fastify's in-process request/response entry point — at `netlify/api/handler.mts:295-303`. There is no TCP socket in the path and no upgrade handling anywhere in the adapter, so the upgrade cannot be intercepted, proxied or worked around inside this file.
- All of `/v1/*` is routed to that single function (`netlify.toml:83-86`), and `scripts/bundle-function.mjs` bundles it as the one deployed function.
- Netlify Functions are per-invocation, short-lived, Lambda-style handlers with a `Request → Response` contract. A WebSocket upgrade at `/v1/realtime` therefore fails on every attempt, not intermittently.

The repository treats this as a host limitation to be fixed by rehosting rather than by code, quoting its own adapter at `netlify/api/handler.mts:39-40`.

### 3.6 The honest banner both chat screens show

When the connection status is anything other than `open`, both chat screens render a permanent line rather than hiding anything:

- Conversation list: `apps/mobile/app/(tabs)/chat.tsx:80-92`.
- Thread: `apps/mobile/app/chat/[id].tsx:266-282`.
- Copy: `'chat.connection.down': 'Live delivery is unavailable — messages send and load normally.'` at `apps/mobile/src/i18n/en.ts:476`, with the Arabic translation at `apps/mobile/src/i18n/ar.ts:492`. Direct reading places the same two keys at `apps/mobile/src/i18n/en.ts:486` and `apps/mobile/src/i18n/ar.ts:502` today; the strings are byte-identical to what the audit quotes, so this is line drift of the kind described in §3.8, not a change of fact.

The wording is deliberate and the reasoning is recorded in the thread screen at `apps/mobile/app/chat/[id].tsx:270-278`: the socket being shut is not the same fact as the device having no connection, so telling an online student they are offline — and that their messages are waiting, when they have already sent over HTTP — would be two false claims. On the current production host this banner is the permanent, correct state rather than a transient warning.

### 3.7 Preview builds — `PREVIEW_ONLY`

In preview builds the socket is deliberately never constructed: `connect()` returns immediately when `IS_PREVIEW_MODE` (`apps/mobile/src/state/realtime.tsx:76-89`), because a preview has no server to hold a socket and repeated retries would be exactly the claim a fixture preview must not make. `IS_PREVIEW_MODE` is a build-time constant from `EXPO_PUBLIC_PREVIEW_MODE` (`apps/mobile/src/preview/preview-mode.ts:40-48`); preview contexts set it and ship zero functions (`netlify.toml:42-65`), with conversations and messages served from fixtures (`apps/mobile/src/state/session.tsx:160`, `apps/mobile/src/preview/fixture-transport.ts:273-277`). This gates the socket only, not Chat: the list, thread, send and read paths all resolve against the fixture transport, and the status semantics — `offline` with the same banner — are identical to production on Netlify.

### 3.8 Divergence between the audit and the repository as read today

The audit describes the deployed client as backing off forever. Direct reading of the repository shows a build-time opt-out that the audit did not record, and it is cited here because it materially qualifies §3.4:

- `apps/mobile/src/state/realtime.tsx:57` — `const REALTIME_ENABLED = process.env.EXPO_PUBLIC_REALTIME !== '0';`
- `apps/mobile/src/state/realtime.tsx:119` — `if (!REALTIME_ENABLED) return;`, placed immediately after the preview-mode guard, so the socket is never constructed when the flag is off.
- `scripts/netlify-build.sh:65` — `export EXPO_PUBLIC_REALTIME=0`, with the surrounding comment at `scripts/netlify-build.sh:55-64` giving the same reason as the adapter and stating that messaging still sends and loads over HTTP and that both chat screens carry the translated banner.

The effect on a Netlify-built client is that it stays honestly `offline` without attempting a connection at all, rather than retrying forever. Every other conclusion in this section is unchanged: `CAN_CURRENT_HOST_RUN_WS` is still `NO`, the banner still shows, and the backoff policy described in §3.4 is still what runs on any build that does not set the flag. Note also that line numbers within `apps/mobile/src/state/realtime.tsx` have drifted by roughly thirty lines below line 57 since the audit was taken (for example, the reconnect scheduler cited as `:148-159` now sits at `:178-188`, and the preview guard cited as `:76-89` now returns at `:113`). Citations to that one file should be read as identifying the construct rather than the exact current line.

### 3.9 What would unblock realtime

The exact runtime requirement, stated as the evidence states it, has two parts:

1. **A host that can hold a socket.** The API must run as a long-lived process that owns a TCP listener and can complete an HTTP upgrade — the shape `apps/api/src/index.ts:35` (`app.listen`) already targets. Nothing in `apps/api` needs to change; the blocker is entirely the per-invocation, `inject()`-based adapter at `netlify/api/handler.mts:295-303`, and the repository says so directly at `netlify/api/handler.mts:39-40`: "Fixing that means a host that can hold a socket, not a change to this file."
2. **A Postgres `LISTEN/NOTIFY` fan-out bridge, once more than one process serves traffic.** The current registry is a single-process `Map` with no broker (`apps/api/src/modules/messaging/realtime.ts:22-26`, `:48-99`). With one process this is correct. With two or more, a message committed by process A would never reach a subscriber attached to process B. The named remedy is a `LISTEN/NOTIFY` bridge behind the unchanged `publish(userIds, frame)` signature, so callers do not change.

Both parts are runtime and hosting decisions. Neither is a gap in the messaging code. The client requires no change at all beyond not setting `EXPO_PUBLIC_REALTIME=0` for such a build (`scripts/netlify-build.sh:55-64`).

### 3.10 Chat is NOT hidden because of the socket

Recording this explicitly, because it is the question most likely to be asked of a product whose realtime channel does not run in production.

**Chat is never hidden, disabled, or feature-flagged off because of the WebSocket.**

- The chat tab is registered unconditionally at `apps/mobile/app/(tabs)/_layout.tsx:132-138`, as one of the "frozen five" tabs per the comment at `apps/mobile/app/(tabs)/_layout.tsx:12-21`. Direct read confirms the `Tabs.Screen name="chat"` entry carries no condition.
- The audit found no conditional rendering and no connection-based or preview-based gate anywhere in `apps/mobile/app/**`.
- Degradation is a banner, not a removal: `apps/mobile/app/(tabs)/chat.tsx:80-92` and `apps/mobile/app/chat/[id].tsx:266-282` render `chat.connection.down` whenever the socket is not open, and everything HTTP keeps working underneath it.
- The only thing that removes the composer is `conversation.viewer.canSend === false` (`apps/mobile/app/chat/[id].tsx:356-432`), which is a permissions decision unrelated to connection status.

The pattern is honesty over hiding: state the limitation in the user's own language and keep the working paths available.

---

## 4. Consolidated readiness

| Unit | Status | Blocking condition |
|---|---|---|
| MESSAGING_CORE — read, page, send, retry, read state, permissions | `CONNECTED_AND_WORKING` | None |
| MESSAGING_CORE — start a new direct conversation | `BACKEND_ONLY` | No UI call path to `POST /v1/conversations` (`messaging.routes.ts:55-68`) |
| MESSAGING_CORE — edit / delete a message | `BACKEND_ONLY` | No client call site (`messaging.routes.ts:157`, `:173`) |
| MESSAGING_CORE — mute a conversation | `BACKEND_ONLY` | No client call site (`social.routes.ts:149`, `:166`) |
| MESSAGING_CORE — per-recipient delivery receipts | `DEAD_CODE` | `message_receipts` reserved-unused (`migrations/0010_messaging_delivery.sql:17-20`) |
| REALTIME_ENHANCEMENT — server | `CONNECTED_AND_WORKING` on a long-lived host | Requires `app.listen` deployment shape (`apps/api/src/index.ts:35`) |
| REALTIME_ENHANCEMENT — client | `CONNECTED_AND_WORKING` | None |
| REALTIME_ENHANCEMENT — in production | `BLOCKED_BY_DEPLOYMENT` | `CAN_CURRENT_HOST_RUN_WS = NO` (`netlify/api/handler.mts:34-39`) |
| REALTIME_ENHANCEMENT — in preview | `PREVIEW_ONLY` | Socket deliberately never opened (`src/state/realtime.tsx:76-89`) |
| Chat visibility | Unconditional | Not gated on the socket (`app/(tabs)/_layout.tsx:132-138`) |

Ordered remediation, smallest first:

1. **Add a UI call path to `POST /v1/conversations`.** The natural site is a Message action on `apps/mobile/app/profile/[handle].tsx`, which is where the existing empty-state journey already dead-ends. This is the only change that converts MESSAGING_CORE from "works for existing conversations" to "works for a new account", and it requires no server work.
2. **Rehost the API on a runtime that can hold a socket.** This alone converts realtime from blocked to working while a single process serves traffic.
3. **Add the `LISTEN/NOTIFY` bridge** behind `publish(userIds, frame)` before a second process is put into service.

---

## 5. Not established by the audit

The following are recorded as unknown rather than guessed:

- Whether messaging has been exercised against a long-lived host in any environment other than the test suite and local development. The evidence establishes that `apps/api/test/messaging.integration.test.ts` exercises send, history and read over `app.inject()` with no socket, and that `apps/api/src/index.ts:35` provides a listening entrypoint, but no realtime end-to-end run against a deployed long-lived host is recorded.
- Which specific replacement host is intended. The evidence names the requirement (a host that can hold a socket) but no chosen target is established by the audit.
- Whether attachments are usable in messaging in practice. `message_attachments` exists in `migrations/0004_messaging.sql` and the send body carries `attachmentFileIds` (`apps/mobile/src/state/outbox.ts:136-145`, always empty at that call site), but the audit records no end-to-end attachment path and the `api` area lists files/media as `PARTIAL`.
- Group-conversation behaviour as distinct from direct conversations, beyond the fact that `canSendMessage` takes the conversation kind into account (`apps/api/src/modules/messaging/conversations.service.ts:344-350`).
- Typing indicators as an end-user-visible feature. The server side is established (`apps/api/src/modules/messaging/realtime.routes.ts:36-39`, `:156-199`) and the thread screen renders `chat.typing` when the socket is open (`apps/mobile/app/chat/[id].tsx:266-268`), but since the socket never opens in production this path is not reachable on the current host, and the audit records no assessment of it beyond that.
