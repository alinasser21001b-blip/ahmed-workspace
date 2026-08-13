# ADR-0010 — One domain-event vocabulary, delivered through a transactional outbox

**Status:** accepted (Phase 3 closure). Vocabulary and storage implemented;
delivery deferred to Phase 8.

## Context

Four things need to know that something happened: notifications, realtime
delivery (Phase 4), the activity surface, and analytics. Three of them do not
exist yet.

The default path is to wire each one into the service that made the change as it
is built. That produces the outcome the product constitution warns about
directly — a second notification architecture appearing beside the first,
because the second consumer had different needs from the first and the first was
not built to be shared.

At the end of Phase 3 the repository had: `notifications`,
`notification_preferences` and `push_tokens` tables with nothing writing to
them, and `recordAnalytics` — a metrics sink, not a delivery mechanism — called
from the membership paths. No event concept existed.

## Decision

One event vocabulary in `@sos/core` (`DomainEventKind`), and one delivery
mechanism: a **transactional outbox** (`domain_events`).

A service that changes state appends its event **inside the same transaction**
as the change. A relay drains the table afterwards.

That ordering is the whole decision:

- an event can never describe a write that rolled back
- a committed write can never lose its event

Publishing after commit gives up the second. Publishing to a broker in-line
gives up the first. Neither failure is visible until it happens in production,
and both are the kind that produce a notification for something a user cannot
find.

`emit()` takes the transaction client as a **required first argument**, so
forgetting it is a compile error rather than a race.

Three further choices worth stating:

- **`kind` is `text`, not an enum.** Adding an event type must be a deploy, not
  a migration taking an exclusive lock on the hottest write path in the product.
  The vocabulary is closed in TypeScript, where it is checked at compile time.
- **The union already contains Phase 4's `message.created`, `message.read` and
  `conversation.created`.** They are three more values in the same union,
  drained by the same relay. That is the point of building this now.
- **Broadcast events carry a null subject.** A join request notifies whoever
  moderates the group, and the event does not enumerate them: writing one row
  per moderator inside the joiner's transaction would make a large group's
  requests expensive for the wrong party. Resolving the audience is the
  consumer's job.

`NOTIFICATION_RULES` is exhaustive over the union rather than a lookup with a
default, so a new event kind that notifies nobody is a decision someone made
rather than an omission nobody noticed.

## Consequences

- Phase 3 produces membership events (`requested`, `approved`, `rejected`,
  `invited`, `removed`, `ownership.transferred`). Nothing consumes them yet, and
  that is stated rather than implied.
- Phase 8 adds the relay and the delivery channels. Phase 4 adds three event
  kinds and no new architecture.
- The collapsing rule (`shouldCollapse`) is pure and unit-tested, so "forty
  likes is one notification" is verified without a database.
- The table grows monotonically. The pending index is partial
  (`WHERE processed_at IS NULL`), so drained history costs nothing to skip;
  archival is a later concern with an obvious answer.
- A removal is deliberately **not** notified to the removed member. Telling
  someone they were ejected from a group they can no longer see turns a quiet
  moderation action into a confrontation. The audit log records it.
