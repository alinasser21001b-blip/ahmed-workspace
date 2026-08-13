-- 0010_messaging_delivery.sql
-- Phase 4. Delivery state, and the indexes the chat list actually needs.

-- ---------------------------------------------------------------------------
-- 1. Delivery is a position, not a row per message per recipient.
--
-- `0004` created `message_receipts (message_id, user_id)` for delivery state.
-- That is one row per message per recipient: a 200-member group chat writes 200
-- rows per message, and the table becomes the fastest-growing object in the
-- product to answer a question worth two ticks in a bubble.
--
-- Read state already avoided this — `conversation_members.last_read_seq` is one
-- integer per member — and delivery has exactly the same shape. So it gets the
-- same treatment. `last_delivered_seq` sits beside `last_read_seq`, and both
-- move monotonically forwards.
--
-- `message_receipts` is left in place, unused. Per-message delivery is a real
-- requirement for a future feature (which of my devices has this message?), and
-- dropping a table to re-add it later is worse than leaving an empty one. It is
-- documented as reserved rather than quietly carried as if it were live.
-- ---------------------------------------------------------------------------

ALTER TABLE conversation_members
  ADD COLUMN last_delivered_seq bigint NOT NULL DEFAULT 0;

-- Both positions only ever move forwards. Enforced here rather than trusted to
-- the application: a receipt that arrives out of order must not rewind a read
-- position and resurrect an unread badge the user already cleared.
ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_delivered_ge_read
  CHECK (last_delivered_seq >= last_read_seq);

-- ---------------------------------------------------------------------------
-- 2. The chat list's query.
--
-- "My conversations, most recent first" joins `conversation_members` (by user)
-- to `conversations` (by recency). `0004` indexed each half separately, so the
-- planner sorted the join result. This covers it in one ordered scan.
-- ---------------------------------------------------------------------------

CREATE INDEX conversation_members_user_recent_idx
  ON conversation_members (user_id, conversation_id)
  WHERE left_at IS NULL;

-- The unread badge across every conversation, which the client polls and the
-- realtime layer recomputes on each delivery.
CREATE INDEX conversation_members_unread_idx
  ON conversation_members (user_id)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Typing and presence are NOT here.
--
-- Typing is ephemeral: it lives in the realtime process, expires on a timer, and
-- is never written. A `typing` row would be a write per keystroke-burst per
-- participant, to represent a fact that is false three seconds later.
--
-- `user_presence` (from 0004) is a single row per user, updated on connect and
-- disconnect. There is no heartbeat table and no per-connection row: a
-- connection count on one row answers "is anyone of theirs online?" without a
-- write every fifteen seconds per device.
-- ---------------------------------------------------------------------------
