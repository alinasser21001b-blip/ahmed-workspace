# Messages

Messages is deliberately the **quietest** surface in the product. No display serif anywhere on it — the editorial voice belongs to knowledge. That volume difference is a design decision, not an omission.

## Conversation list

**Route** `app/(tabs)/chat.tsx`
**Purpose** Show which conversations need attention.
**Primary user question** "Who is waiting for me?"
**Dominant action** none. A list of equals.
**Secondary actions** open a conversation; (new conversation reachable from Search → profile → Message).

**Source repo files** `app/(tabs)/chat.tsx`, `packages/contracts/src/social/messaging.contract.ts`, `packages/core/src/messaging/message-state.ts`, `src/state/realtime.tsx`.
**Required data** `Conversation`: id, title or counterpart profile summary, `lastMessagePreview`, `lastMessageAt`, `viewer.unreadCount` (derived `lastSeq - lastReadSeq`).
**Optional data** typing indicator, connection state.
**Unsupported data** online status / last seen (the *privacy fields* exist — `showOnlineStatus`, `showLastSeen` — but no presence channel does), delivery receipts on the list row, message-level search.

**Hierarchy** Title "Messages" → connection line when the socket is not open → hairline-separated ConversationRows.

**Behaviour** · one scroll container · loading: skeleton rows · empty: "No conversations yet" + "Search people" · error + retry · **offline: the connection line is always visible when the socket is not open, in attention — a student who cannot see why a message has not sent assumes it was lost** · RTL: avatar leads, timestamp trails, preview truncates at the reading end · unread badge is structure with a count, and the name goes to weight 600 so unread survives greyscale · Dynamic Type: rows grow from 72 px, preview stays one line · accessibility: one element per row, "Renal block study group, 3 unread, 4 minutes ago, Omar: …".

**Status** SUPPORTED_NOW.

## Conversation

**Route** `app/chat/[id].tsx`
**Purpose** Read and reply.
**Dominant action** send.
**Secondary actions** back, retry a failed message.

**Required data** messages (body, author, seq, createdAt, deletedAt), own/other, per-message `MessageState`, the read position on entry.
**Unsupported data** structured academic references, attachments of any kind, reactions, replies-to, forwarding, edits.

**Hierarchy** back + counterpart identity + typing → day separator → bubbles → UnreadDivider pinned at the entry read position → composer.

### All six message states are required

`queued` · `sending` · `sent` · `delivered` · `read` · `failed`. Turn 5 drew three; the contract defines six and `message-state.ts` enforces the legal transitions. Own bubbles are **ink, not teal**. Failed carries the word "Failed" plus a 44 px retry.

Retry is idempotent: `(conversation_id, client_message_id)` is unique server-side, so the worst case is the server returning the row it already stored. Backoff is exponential from 1 s, capped at 30 s, 5 attempts, then terminal until the user taps retry.

Out-of-order receipts are normal — a `read` webhook can beat `delivered`. Use `advance()`; never set state directly.

### The unread divider

Pinned at the read position captured **on entry** and immutable for the session. It must not slide as messages arrive or as the thread marks itself read. Anything else makes it useless.

**Behaviour** · inverted scroll container, composer pinned, bottom inset added · keyboard: the composer rises with it; the last message stays visible; the header does not move · loading: skeleton bubbles · empty: "No messages yet" + a line inviting the first · error + retry · **offline: composer stays usable and queues; the banner states it** · **restricted (`chat.readOnly`, e.g. an announcement channel): the composer is REMOVED and replaced by "Only instructors can post here. You can read every message." — never a disabled composer, which invites a tap that will never work** · deleted message: "This message was deleted", body suppressed, bubble kept · RTL: own bubbles align to the reading end via flex; **the send glyph mirrors** — a paper plane depicts motion along the writing direction · mixed script: Arabic message with `KDIGO`, `Nelson 21e`, `@renal_block`, `21:40` each isolated · Dynamic Type: bubbles grow, max 85% width · 360 px: no horizontal scroll at any size.

**Accessibility** each bubble is one element: "You: …, sent" or "{sender}: …". Retry is a separate button. New incoming messages announce politely via a live region — never assertively, which interrupts reading. The divider is announced once as "Unread messages below".

**Status** SUPPORTED_NOW.
**Blockers** structured references, attachments, presence — all BLOCKED_BY_PRODUCT_CAPABILITY.
