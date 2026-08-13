-- 0004_messaging.sql
-- Real-time messaging with delivery guarantees (§15, §52).
--
-- Three properties the schema must guarantee, because they cannot be retrofitted:
--
--  1. IDEMPOTENCY — the client mints `client_message_id` before sending. The
--     server upserts on (conversation_id, client_message_id). A retry after a
--     dropped response produces the same row, never a duplicate.
--
--  2. ORDERING — `seq` is a per-conversation monotonic integer assigned by the
--     server under a row lock on the conversation. Clients sort by seq and NEVER
--     by client clock, which is unreliable across devices and time zones.
--
--  3. GAP RECOVERY — a reconnecting client sends its last known seq; the server
--     replays `seq > last_known`. This is only possible because seq is dense
--     and server-assigned.

CREATE TYPE conversation_kind AS ENUM ('direct', 'group');
CREATE TYPE message_kind      AS ENUM ('text', 'image', 'file', 'audio', 'video', 'system', 'share');

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        conversation_kind NOT NULL,
  -- A group's conversation. One conversation per group, enforced below.
  group_id    uuid REFERENCES groups(id) ON DELETE CASCADE,
  title       text,
  avatar_url  text,
  -- Monotonic sequence counter. Incremented under a row lock when a message is
  -- inserted; this row IS the lock that serialises a conversation's writes.
  last_seq    bigint NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversations_group_kind CHECK (
    (kind = 'group') OR (group_id IS NULL)
  )
);
CREATE UNIQUE INDEX conversations_group_uniq ON conversations (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX conversations_recent_idx ON conversations (last_message_at DESC NULLS LAST);
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            membership_role NOT NULL DEFAULT 'member',
  -- Read state lives on the membership row: last_read_seq is the single source
  -- of truth for both read receipts and unread counts. Unread count is
  -- (conversations.last_seq - last_read_seq), computed, never stored twice.
  last_read_seq   bigint NOT NULL DEFAULT 0,
  muted_until     timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx
  ON conversation_members (user_id) WHERE left_at IS NULL;

-- Direct conversations must be unique per unordered pair. The pair key is
-- computed by the service as least(a,b)||':'||greatest(a,b) so that (A,B) and
-- (B,A) collide.
CREATE TABLE direct_conversation_keys (
  pair_key        text PRIMARY KEY,
  conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  seq               bigint NOT NULL,
  client_message_id uuid NOT NULL,
  kind              message_kind NOT NULL DEFAULT 'text',
  body              text,
  reply_to_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  -- Shared academic object (a lecture, a quiz, a content item) rendered as a
  -- rich card in the thread. This is how learning context enters chat without
  -- cluttering the chat UI with learning controls (§58).
  share_kind        text,
  share_id          uuid,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT messages_body_len CHECK (body IS NULL OR char_length(body) <= 8000),
  CONSTRAINT messages_share_pair CHECK (
    (share_kind IS NULL) = (share_id IS NULL)
  ),
  CONSTRAINT messages_share_kind CHECK (
    share_kind IS NULL OR share_kind IN ('content', 'lecture', 'quiz', 'resource', 'study_session')
  )
);

-- Idempotency key: a retried send collapses onto the same row.
CREATE UNIQUE INDEX messages_client_id_uniq ON messages (conversation_id, client_message_id);
-- Ordering + gap replay: both are this one index.
CREATE UNIQUE INDEX messages_seq_uniq ON messages (conversation_id, seq);
CREATE INDEX messages_conversation_recent_idx
  ON messages (conversation_id, seq DESC) WHERE deleted_at IS NULL;

ALTER TABLE reactions
  ADD CONSTRAINT reactions_message_fk
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;

CREATE TABLE message_attachments (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  ordinal     smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, file_id)
);

-- Per-recipient delivery state. Read state is derived from
-- conversation_members.last_read_seq; this table records DELIVERY, which is a
-- device-level fact that last_read_seq cannot express.
CREATE TABLE message_receipts (
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Presence (§16). Deliberately a plain table rather than a distributed
-- presence service: at cohort scale this is a single indexed read.
CREATE TABLE user_presence (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'offline',
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  connection_count integer NOT NULL DEFAULT 0,
  CONSTRAINT user_presence_status CHECK (status IN ('online', 'away', 'offline')),
  CONSTRAINT user_presence_conn_nonneg CHECK (connection_count >= 0)
);
CREATE INDEX user_presence_online_idx ON user_presence (status) WHERE status <> 'offline';
