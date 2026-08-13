# ADR-0011 — The realtime socket notifies; the database decides

**Status:** accepted (Phase 4)

## Context

A chat needs to feel instant. The obvious way to build one is to make the
WebSocket the write path: the client sends a message frame, the server
broadcasts it to the room, and it is persisted somewhere along the way.

That design has a failure mode with no recovery. If the process handling the
socket dies between the broadcast and the write — or the write fails a
constraint, or the transaction rolls back — every participant is holding a
message the server does not have. Nobody can detect it: the sender saw an ack,
the recipients saw the message, and the database has no row. The next reload
silently deletes a conversation that everyone remembers having.

There is a second, quieter version of the same problem. If the socket is the
only delivery path, a client that misses a frame has no way to discover it. A
dropped connection becomes lost data rather than late data.

## Decision

**Every write is HTTP. The socket carries notifications about state that is
already committed.**

    client → POST /messages → policy → transaction (seq assigned) → COMMIT
                                                                 → publish(frame)

Three consequences follow, and each is worth more than the architectural
tidiness:

1. **The publish happens after the commit, never inside it.** A frame therefore
   cannot describe a rolled-back write. `publish` also never throws — the caller
   has already committed, and a dead client must not change the outcome of a
   database transaction.

2. **Every message is reachable without the socket.** `GET /conversations/:id/
   messages?afterSeq=N` returns exactly what a client is missing. The socket is
   an optimisation over that, which is what makes a dropped connection a
   *latency* problem. On reconnect the client sends its highest known `seq` and
   the server replays the gap, oldest-first, so a truncated replay leaves a
   contiguous prefix rather than a hole.

3. **Retries are ordinary HTTP retries.** Idempotency is
   `(conversation_id, client_message_id)`, enforced by a unique index. An
   offline queue is a list of requests to replay, not a bespoke protocol —
   which is why the client's outbox is fifty lines and not five hundred.

There is deliberately **no `message.send` frame** in the protocol. Adding one
later would reintroduce the failure mode this decision exists to prevent.

The socket accepts only subscriptions (`subscribe`, `unsubscribe`), an
ephemeral hint (`typing`), and a read request (`resync`). None of them writes to
the database. Subscription is gated by the same policy the REST read uses, so a
subscription can never grant access the HTTP API would refuse.

## Consequences

- Sending is one round trip slower than a socket write. At cohort scale over
  campus wifi this is not measurable against the time the message takes to
  render, and it buys a guarantee that cannot be added later.
- The fan-out registry is an in-process `Map`. One process, and that is correct
  at this scale rather than merely convenient. A second process needs a
  Postgres `LISTEN/NOTIFY` bridge behind the same `publish(userIds, frame)`
  signature; no caller changes, because no caller knows more than that.
- Typing is never persisted and expires on a server-side timer, so a client
  that dies mid-word does not leave an indicator up. Presence is one row per
  user with a connection count — no heartbeat table, no row per connection.
- The two-user E2E can assert the whole contract, because every guarantee is
  observable from outside: it drops a real connection, sends into the gap,
  reconnects, and checks that the sequence is dense and nothing arrived twice.
