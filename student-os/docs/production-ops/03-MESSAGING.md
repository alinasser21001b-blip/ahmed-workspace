# 03 — Messaging

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§4 Messaging**: persistence, realtime transport, offline delivery, multi-device sync, read/unread state, retention implications, storage-growth architecture. Constraint from the brief: **do not move to device-only message storage.** This document does not — PostgreSQL remains the sole source of truth throughout.

## 1. The governing design: ADR-0011 (`EXISTS_NOW`)

`docs/adr/0011-realtime-notifies-database-decides.md`, accepted Phase 4 — *"The realtime socket notifies; the database decides."*

- **Every write is HTTP; never the socket.** The socket carries only `subscribe` / `unsubscribe` / `typing` / `resync`. There is deliberately **no `message.send` frame**, specifically to prevent the failure mode where a client believes a message sent that the database never committed. `realtime.ts`'s own header states it: *"the inverse — client → socket → hope it persisted — loses messages whenever a process dies between the ack and the write, and the loss is invisible to both ends."*
- **The socket is never a source of truth.** *"A client that misses frames is not broken; it reconnects and asks for the gap by seq. Every frame is therefore an optimisation over polling, never the only delivery path. That property is what makes a dropped socket a latency problem rather than a data-loss one."*
- **Authorization is not performed in the realtime layer.** Sockets join a conversation's audience only after `canSubscribe` — the same policy the REST read path uses — has admitted them. There is no path by which a subscription grants access the REST API would refuse.

This design already satisfies the brief's constraint at the architecture level, and it is what makes the transport failure in §2 survivable rather than catastrophic. **Nothing in this document changes it.**

## 2. Realtime transport: non-functional in production (`BLOCKED_BY_EXTERNAL_DEPENDENCY`)

**The realtime WebSocket at `/v1/realtime` does not work on the deployed Netlify host at all.** A function is invoked per request and cannot hold a connection open, so the upgrade fails. This is stated in the deployment code itself (`handler.mts:34-39`) and recorded in `docs/app-store/06-APP-REVIEW-NOTES.md:32` and `docs/app-store/00-READINESS-AUDIT.md:90`.

**The precise client consequence**, which matters because the App Store notes describe it imprecisely: the mobile client's `RealtimeProvider` retries the connection forever with exponential backoff and never succeeds. **There is no periodic poll anywhere in the client.** New incoming messages surface only when a screen is reopened or refocused. That is **load-on-demand, not polling** — and the App Store review notes calling it "polling" is itself a small documentation inaccuracy worth correcting when that document is next touched (not in this PR).

**What is and is not at risk:**

- **Not at risk: message durability, ordering, or delivery correctness.** Because sends are HTTP and gaps are replayed by `seq`, nothing is ever lost. Reopening a screen produces the complete, correct history.
- **At risk: the product experience.** A messaging feature where messages do not arrive until the user reopens the screen is a materially different product from the one the UI implies.

The three options — accept it for the pilot, deploy the existing long-running server, or front realtime with a managed relay — are laid out in `01-TARGET-ARCHITECTURE.md` §4. This is a **product decision, not a technical unknown**, and it should be made explicitly rather than inherited by default.

**In-process registry.** `realtime.ts:48` holds `Map<userId, Set<Connection>>` — per process, and its own comment names the successor: *"When a second process is needed, this file grows a Postgres `LISTEN/NOTIFY` bridge behind the same `publish` signature — the callers do not change."* On Netlify this limitation is **moot**, because no sockets are ever held there. It becomes live the moment option B or C in `01-TARGET-ARCHITECTURE.md` §4 is chosen.

## 3. Persistence and ordering (`EXISTS_NOW`)

Messages persist in PostgreSQL. Two unique indexes — not application logic — enforce the guarantees:

- **Idempotency**: `(conversation_id, client_message_id)` unique. A retried send from the mobile `Outbox` cannot duplicate a message.
- **Gapless ordering**: `(conversation_id, seq)` unique. `conversations.last_seq` is a monotonic per-conversation counter incremented under a `SELECT ... FOR UPDATE` row lock at insert time.

**The row lock is a real contention point.** Every message send in a given conversation serializes on that conversation's row. This is correct — gapless `seq` assignment requires it — but under concurrent senders in one very active conversation it holds a pooled database connection for the duration of the transaction, which is exactly why the missing `statement_timeout` in `02-DATA-STORAGE.md` §4 matters here specifically.

## 4. Offline delivery and multi-device sync (`EXISTS_NOW`)

The `afterSeq` / `resync` mechanism is the answer to both, and it is a good one: any device, on reconnect or reopen, asks *"what happened after the last seq I saw"* and receives a complete, durable answer from PostgreSQL — never from the socket, never from another device. No architecture change recommended.

**Read/unread and delivery state is per-account and server-side, not per-device**: `conversation_members.last_read_seq` and `last_delivered_seq`, keyed by `(conversation_id, user_id)`. A phone and a laptop on the same account correctly share one read cursor. Storage is O(1) per membership, not per message — this is the post-`0010` design that replaced the abandoned `message_receipts` table (see `02-DATA-STORAGE.md` §2.1; an earlier draft of this set had that history backwards).

## 5. Retention and the storage-growth architecture

The brief asks for a storage-growth *estimate architecture*, and the honest answer is that the right frame is two separate questions, not one row count:

1. **Message rows are retained indefinitely, by default and correctly.** A student's private message history is core product value, unlike an analytics event. **This document proposes no deletion policy for user messages.** The growth lever is **partitioning by time**, not deletion — the same lever `02-DATA-STORAGE.md` recommends for `audit_log`, and for the same reason: it changes physical layout without losing content, and it is far cheaper to do before the table is large.
2. **Per-recipient fan-out is already solved.** The `0010` migration removed the `messages × recipients` growth term from the write path entirely by replacing per-recipient receipt rows with a per-membership counter. This is why messaging storage now grows roughly linearly with messages sent rather than with messages × group size — the single most important growth fact in this section, and one the schema authors had already reasoned through.

The practical monitoring signal, once `05-MONITORING.md`'s aggregation exists: track `messages` table size and growth *rate*, and revisit partitioning when backup duration or index maintenance becomes measurably affected — not at a pre-committed row count this audit has no evidence to pick.

## 6. Constraint check

> *PostgreSQL = structured truth, Object Storage = heavy binary content, Device = cache/offline. Do not propose storing large media blobs in PostgreSQL. Do not move to device-only message storage.*

Both hold. Message text and all state (`seq`, read cursors, delivery cursors) stay in PostgreSQL as the source of truth. The device caches what the API returns and originates writes over HTTP; it is never authoritative. Message **attachments** are object storage, not PostgreSQL — and are subject to the same image-only constraint as the rest of the system (`04-MEDIA-CDN.md`): four image formats by magic-byte sniff, 8 MiB cap, no video/PDF/PowerPoint byte-upload path anywhere in the API.

## 7. Summary

| Finding | Status | Action | Priority |
|---|---|---|---|
| HTTP-only writes, socket notification-only, gap-replay by `seq` | `EXISTS_NOW`, correct | Preserve as-is | — |
| Realtime WebSocket non-functional on Netlify; no client polling fallback | `BLOCKED_BY_EXTERNAL_DEPENDENCY` | Decide option A/B/C in `01-TARGET-ARCHITECTURE.md` §4 | **P1 — product decision** |
| Idempotency + gapless ordering by unique index | `EXISTS_NOW`, correct | Preserve | — |
| `SELECT ... FOR UPDATE` contention on hot conversations | `EXISTS_NOW`, inherent to the guarantee | Mitigated by `statement_timeout` | P0 (via `02-DATA-STORAGE.md`) |
| Per-account read/delivery cursors, multi-device correct | `EXISTS_NOW` | Preserve | — |
| `messages` unpartitioned | gap | Partition by time when size warrants; **no deletion policy** | P2 |
| App Store notes describe the fallback as "polling" | documentation inaccuracy | Correct when that document is next touched — not in this PR | P2 |
