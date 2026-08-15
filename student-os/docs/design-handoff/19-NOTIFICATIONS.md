# Notifications

## Status first

**BLOCKED_BY_PRODUCT_CAPABILITY.** What exists: the event enum and `NOTIFICATION_RULES` including collapse windows (`packages/core/src/events/domain-events.ts`), notification tables (migration 0006), push-token storage, and a transactional outbox. What does not exist: **an event producer draining the outbox, an API route, and a client screen.**

Push-token storage existing is not evidence of a working push system. Nothing in this file may be presented as implemented.

This file is the design contract so that when the producer is built there is no second design phase.

## Route

`notifications` — **not registered in `app/_layout.tsx`.** Add as a pushed screen from a Home header glyph, not a sixth tab.

## Grammar

Four groups, taken from the rule table rather than invented. The groups are the notifying event kinds gathered by what they are *about*:

| Group | Colour | Events | Collapse |
| --- | --- | --- | --- |
| **Your knowledge was challenged** | challenged | correction proposed against your content; your correction accepted | none — each is individual |
| **Replies and mentions** | ink | comment on your content; mention | comments fold within 15 min |
| **Groups and classrooms** | ink | join approved; join requested (you moderate); new content in a group you belong to | group posts fold within 1 hour |
| **Messages** | ink | new messages in a conversation | fold within 5 min |

**Ordering** is by group, not strictly by time: the correction group leads. A challenge to your own work is the one event a student cannot discover by looking at the product, so it is the one event that earns the top of the tray.

## Collapsing is specified, so implement it

The rule table defines the windows. The tray therefore says "3 comments on your nephrotic syndrome explanation" with "Zainab, Omar and 1 other · within the last 15 minutes" — not three rows. A collapsed row navigates to the target, not to a sub-list.

## Two deliberate silences — preserve them

1. **Removal from a group produces no notification.** The audit log records it. Telling a student they were removed, in a push, is a punishment the product does not deliver.
2. **A rejected correction produces no notification.** The status is visible on the content itself. A push saying "you were wrong" is not something this product sends.

If a future engineer adds either, it is a product decision requiring sign-off, not a bug fix.

## Row anatomy

Correction events use the knowledge display voice (they are about knowledge). Everything else is 15/22 weight 500 plus a MetadataLine. Unread carries a structure-coloured leading marker **and** a heavier weight, so unread survives greyscale.

## Behaviour when built

· one scroll container · loading: skeleton rows · **empty: "Nothing new" + "Only things you cannot see by looking." — no action, and this is the one legitimate actionless empty state in the product** · error + retry · offline: cached list, banner, read-state changes queue · RTL: markers at the reading edge, Arabic relative times, Latin names isolated · Dynamic Type: sentences wrap · accessibility: group headings are headers; each row is one label ending with its relative time; the unread marker is announced as "unread"; the tray must not announce a count assertively on open.

## Required to unblock

1. Event producer that writes notification rows from domain events, honouring `NOTIFICATION_RULES`.
2. Outbox drain with retry.
3. `GET` list (cursor-paginated), `POST` mark-read, `POST` mark-all-read.
4. Collapse applied server-side — the client must not re-derive windows.
5. Client route + a Home header glyph with an unread count.
6. Push registration and permission flow (an Apple submission dependency in its own right).

Estimated complexity **L**, and it is the largest blocked item after topic search.
