import type { ConversationKind, MembershipRole, MessageKind } from '@sos/contracts';
import type { ConversationMembership, ConversationRef } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Conversation and message persistence.
 *
 * The one non-obvious thing in this file is `insertMessage`, and it is the
 * reason the whole delivery contract holds. Read its comment before changing
 * anything about it.
 */

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  group_id: string | null;
  title: string | null;
  avatar_url: string | null;
  last_seq: string;
  last_message_at: Date | null;
  created_at: Date;
  viewer_role: MembershipRole | null;
  viewer_last_read_seq: string | null;
  viewer_left_at: Date | null;
  viewer_muted_until: Date | null;
  /** The other participant of a direct conversation, resolved per reader. */
  counterpart_user_id: string | null;
  counterpart_handle: string | null;
  counterpart_display_name: string | null;
  counterpart_avatar_url: string | null;
  counterpart_verification_level: 'unverified' | 'student' | 'instructor' | 'official' | null;
  group_name: string | null;
  last_message_body: string | null;
  last_message_kind: MessageKind | null;
}

export function toConversationRef(row: ConversationRow): ConversationRef {
  return { id: row.id, kind: row.kind, groupId: row.group_id };
}

export function toMembership(row: ConversationRow): ConversationMembership | null {
  if (!row.viewer_role) return null;
  return { role: row.viewer_role, leftAt: row.viewer_left_at };
}

/*
 * The counterpart join.
 *
 * A direct conversation has no "title" — it is titled by whoever the reader is
 * not. Resolving that in SQL rather than in the service keeps the chat list one
 * query instead of one query plus a lookup per row.
 */
const CONVERSATION_SELECT = `
  SELECT c.id, c.kind, c.group_id, c.title, c.avatar_url,
         c.last_seq::text AS last_seq, c.last_message_at, c.created_at,
         me.role AS viewer_role,
         me.last_read_seq::text AS viewer_last_read_seq,
         me.left_at AS viewer_left_at,
         me.muted_until AS viewer_muted_until,
         other.user_id AS counterpart_user_id,
         op.handle AS counterpart_handle,
         op.display_name AS counterpart_display_name,
         op.avatar_url AS counterpart_avatar_url,
         ou.verification_level AS counterpart_verification_level,
         g.name AS group_name,
         lm.body AS last_message_body,
         lm.kind AS last_message_kind
  FROM conversations c
  JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1::uuid
  LEFT JOIN groups g ON g.id = c.group_id
  LEFT JOIN LATERAL (
    SELECT cm.user_id FROM conversation_members cm
    WHERE cm.conversation_id = c.id AND cm.user_id <> $1::uuid AND c.kind = 'direct'
    LIMIT 1
  ) other ON true
  LEFT JOIN profiles op ON op.user_id = other.user_id
  LEFT JOIN users ou ON ou.id = other.user_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.kind FROM messages m
    WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
    ORDER BY m.seq DESC
    LIMIT 1
  ) lm ON true
`;

export async function findConversationById(
  conversationId: string,
  viewerId: string,
  client?: Sql,
): Promise<ConversationRow | null> {
  return queryOne<ConversationRow>(
    `${CONVERSATION_SELECT} WHERE c.id = $2::uuid`,
    [viewerId, conversationId],
    client,
  );
}

/**
 * The chat list.
 *
 * Ordered by recency, keyset-paginated on `(last_message_at, id)`. Membership is
 * an inner join, so there is no visibility clause to get wrong: a conversation
 * you are not in cannot appear, and its id cannot be inferred from a gap.
 */
export async function listConversations(
  viewerId: string,
  cursor: { lastMessageAt: number; id: string } | null,
  limit: number,
  client?: Sql,
): Promise<ConversationRow[]> {
  const params: unknown[] = [viewerId, limit + 1];
  let cursorClause = '';
  if (cursor) {
    params.push(new Date(cursor.lastMessageAt), cursor.id);
    // COALESCE so a conversation with no messages yet sorts by its creation
    // instead of vanishing from the ordering entirely.
    cursorClause = `AND (COALESCE(c.last_message_at, c.created_at), c.id) < ($3::timestamptz, $4::uuid)`;
  }

  return queryRows<ConversationRow>(
    `${CONVERSATION_SELECT}
     WHERE me.left_at IS NULL ${cursorClause}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
     LIMIT $2`,
    params,
    client,
  );
}

/** The tab badge: everything unread, in one query rather than one per row. */
export async function totalUnread(viewerId: string, client?: Sql): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(GREATEST(0, c.last_seq - cm.last_read_seq)), 0)::text AS total
     FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.user_id = $1::uuid AND cm.left_at IS NULL`,
    [viewerId],
    client,
  );
  return Number(row?.total ?? 0);
}

// --- creation ---------------------------------------------------------------

/**
 * The pair key for a direct conversation.
 *
 * Sorted, so (A,B) and (B,A) produce the same string and collide on the primary
 * key. Without this, two students who open each other's profile at the same
 * moment end up with two threads and half the history in each.
 */
export function directPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Finds or creates the direct conversation for a pair.
 *
 * `ON CONFLICT DO NOTHING` on the pair key, then re-read: two concurrent
 * requests race, one inserts, both end up with the same conversation. The
 * alternative — check-then-insert — has a window between the two statements
 * that is exactly wide enough for the duplicate.
 */
export async function findOrCreateDirect(
  userA: string,
  userB: string,
  client: Sql,
): Promise<{ id: string; created: boolean }> {
  const pairKey = directPairKey(userA, userB);

  const existing = await queryOne<{ conversation_id: string }>(
    `SELECT conversation_id FROM direct_conversation_keys WHERE pair_key = $1`,
    [pairKey],
    client,
  );
  if (existing) return { id: existing.conversation_id, created: false };

  const conversation = await queryOne<{ id: string }>(
    `INSERT INTO conversations (kind, created_by) VALUES ('direct', $1) RETURNING id`,
    [userA],
    client,
  );
  if (!conversation) throw new Error('conversation insert returned no row');

  const claimed = await queryOne<{ conversation_id: string }>(
    `INSERT INTO direct_conversation_keys (pair_key, conversation_id)
     VALUES ($1, $2)
     ON CONFLICT (pair_key) DO NOTHING
     RETURNING conversation_id`,
    [pairKey, conversation.id],
    client,
  );

  if (!claimed) {
    // Lost the race. Drop the conversation we just made and adopt theirs.
    await queryOne(`DELETE FROM conversations WHERE id = $1`, [conversation.id], client);
    const winner = await queryOne<{ conversation_id: string }>(
      `SELECT conversation_id FROM direct_conversation_keys WHERE pair_key = $1`,
      [pairKey],
      client,
    );
    if (!winner) throw new Error('direct conversation key vanished mid-transaction');
    return { id: winner.conversation_id, created: false };
  }

  await queryOne(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
    [conversation.id, userA, userB],
    client,
  );

  return { id: conversation.id, created: true };
}

/**
 * Finds or creates a group's conversation, and reconciles its membership with
 * the group's.
 *
 * Group membership seeds conversation membership rather than replacing it: the
 * conversation keeps its own rows, so leaving the chat is a thing you can do
 * without leaving the group, and a member removed from the group loses the chat
 * on their next read.
 */
export async function findOrCreateGroupConversation(
  groupId: string,
  actorId: string,
  client: Sql,
): Promise<{ id: string; created: boolean }> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM conversations WHERE group_id = $1`,
    [groupId],
    client,
  );

  const conversationId =
    existing?.id ??
    (
      await queryOne<{ id: string }>(
        `INSERT INTO conversations (kind, group_id, created_by) VALUES ('group', $1, $2)
         ON CONFLICT (group_id) WHERE group_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [groupId, actorId],
        client,
      )
    )?.id;

  if (!conversationId) {
    const winner = await queryOne<{ id: string }>(
      `SELECT id FROM conversations WHERE group_id = $1`,
      [groupId],
      client,
    );
    if (!winner) throw new Error('group conversation vanished mid-transaction');
    return { id: winner.id, created: false };
  }

  /*
   * Reconcile: every active group member gets a conversation row, carrying the
   * group role so a group moderator can moderate the chat. Members who left the
   * conversation deliberately keep `left_at` — `DO UPDATE` touches the role
   * only, so rejoining the chat stays an explicit act.
   */
  await queryOne(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     SELECT $1, gm.user_id, gm.role
     FROM group_members gm
     WHERE gm.group_id = $2 AND gm.status = 'active'
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [conversationId, groupId],
    client,
  );

  return { id: conversationId, created: !existing };
}

// --- messages ---------------------------------------------------------------

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: string;
  client_message_id: string;
  kind: MessageKind;
  body: string | null;
  sender_id: string | null;
  reply_to_id: string | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  author_handle: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_verification_level: 'unverified' | 'student' | 'instructor' | 'official' | null;
  attachments: {
    fileId: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }[];
}

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.seq::text AS seq, m.client_message_id, m.kind,
         CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END AS body,
         m.sender_id, m.reply_to_id, m.edited_at, m.deleted_at, m.created_at,
         p.handle AS author_handle,
         p.display_name AS author_display_name,
         p.avatar_url AS author_avatar_url,
         u.verification_level AS author_verification_level,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'fileId', f.id, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes,
                    'width', f.metadata->'width', 'height', f.metadata->'height'
                  ) ORDER BY ma.ordinal)
           FROM message_attachments ma
           JOIN files f ON f.id = ma.file_id AND f.deleted_at IS NULL
           WHERE ma.message_id = m.id
         ), '[]'::json) AS attachments
  FROM messages m
  LEFT JOIN profiles p ON p.user_id = m.sender_id
  LEFT JOIN users u ON u.id = m.sender_id
`;

export async function findMessageById(
  messageId: string,
  client?: Sql,
): Promise<MessageRow | null> {
  return queryOne<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1::uuid`, [messageId], client);
}

/**
 * A page of messages, by seq.
 *
 * `beforeSeq` scrolls backwards; `afterSeq` replays the gap after a reconnect.
 * Neither uses a timestamp: two messages can share a millisecond, and a page
 * boundary that is not total drops or repeats a row.
 */
export async function listMessages(
  conversationId: string,
  range: { beforeSeq?: number | undefined; afterSeq?: number | undefined },
  limit: number,
  client?: Sql,
): Promise<MessageRow[]> {
  const params: unknown[] = [conversationId, limit];
  const conditions = ['m.conversation_id = $1::uuid'];

  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (range.afterSeq !== undefined) conditions.push(`m.seq > ${push(range.afterSeq)}::bigint`);
  if (range.beforeSeq !== undefined) conditions.push(`m.seq < ${push(range.beforeSeq)}::bigint`);

  /*
   * A gap replay reads FORWARDS from the client's last seq — the oldest missing
   * message first — so a truncated replay leaves a contiguous prefix and the
   * client asks again from the new head. Reading backwards would hand back the
   * newest N and leave a hole in the middle, which is the one shape the client
   * cannot detect.
   */
  const ascending = range.afterSeq !== undefined;

  return queryRows<MessageRow>(
    `${MESSAGE_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.seq ${ascending ? 'ASC' : 'DESC'}
     LIMIT $2`,
    params,
    client,
  );
}

export interface InsertMessageInput {
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  kind: MessageKind;
  body: string | null;
  replyToId: string | null;
}

/**
 * Inserts a message, or returns the one this client already sent.
 *
 * This function is the delivery contract. Three things happen in one statement
 * chain, inside the caller's transaction:
 *
 *  1. `SELECT … FOR UPDATE` on the conversation row. That row IS the lock that
 *     serialises writes to this conversation, which is what makes `seq` dense
 *     and gapless. Two concurrent senders queue; neither gets the same number.
 *
 *  2. The insert takes `last_seq + 1`, and `ON CONFLICT (conversation_id,
 *     client_message_id) DO NOTHING` collapses a retry onto the row that
 *     already exists. A dropped response is therefore harmless: the client
 *     resends the same `client_message_id` and gets the same message back, with
 *     the same seq, and nothing is duplicated.
 *
 *  3. `last_seq` and `last_message_at` advance only when the insert actually
 *     produced a row. A retry must not burn a sequence number — a gap in `seq`
 *     would make a reconnecting client wait forever for a message that never
 *     existed.
 *
 * The lock is taken before the conflict check rather than after, so the retry
 * path serialises too. It is the slower ordering and the only correct one.
 */
export async function insertMessage(
  input: InsertMessageInput,
  client: Sql,
): Promise<{ id: string; seq: number; deduplicated: boolean }> {
  const locked = await queryOne<{ last_seq: string }>(
    `SELECT last_seq::text AS last_seq FROM conversations WHERE id = $1 FOR UPDATE`,
    [input.conversationId],
    client,
  );
  if (!locked) throw new Error('conversation vanished before insert');

  const nextSeq = Number(locked.last_seq) + 1;

  const inserted = await queryOne<{ id: string; seq: string }>(
    `INSERT INTO messages (conversation_id, sender_id, seq, client_message_id, kind, body, reply_to_id)
     VALUES ($1, $2, $3, $4, $5::message_kind, $6, $7)
     ON CONFLICT (conversation_id, client_message_id) DO NOTHING
     RETURNING id, seq::text AS seq`,
    [
      input.conversationId,
      input.senderId,
      nextSeq,
      input.clientMessageId,
      input.kind,
      input.body,
      input.replyToId,
    ],
    client,
  );

  if (!inserted) {
    const existing = await queryOne<{ id: string; seq: string }>(
      `SELECT id, seq::text AS seq FROM messages
       WHERE conversation_id = $1 AND client_message_id = $2`,
      [input.conversationId, input.clientMessageId],
      client,
    );
    if (!existing) throw new Error('message insert conflicted with a row that does not exist');
    return { id: existing.id, seq: Number(existing.seq), deduplicated: true };
  }

  await queryOne(
    `UPDATE conversations SET last_seq = $2, last_message_at = now() WHERE id = $1`,
    [input.conversationId, nextSeq],
    client,
  );

  /*
   * The sender has, by definition, read their own message. Advancing their
   * position here rather than waiting for a client round trip is what stops a
   * user's own message counting towards their unread badge for as long as the
   * network takes.
   */
  await queryOne(
    `UPDATE conversation_members
     SET last_read_seq = GREATEST(last_read_seq, $3::bigint),
         last_delivered_seq = GREATEST(last_delivered_seq, $3::bigint)
     WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.senderId, nextSeq],
    client,
  );

  return { id: inserted.id, seq: Number(inserted.seq), deduplicated: false };
}

export async function attachFiles(
  messageId: string,
  fileIds: readonly string[],
  client: Sql,
): Promise<void> {
  if (fileIds.length === 0) return;
  await queryOne(
    `INSERT INTO message_attachments (message_id, file_id, ordinal)
     SELECT $1, id, ordinality - 1
     FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ordinality)
     ON CONFLICT DO NOTHING`,
    [messageId, fileIds],
    client,
  );
}

export async function updateMessageBody(
  messageId: string,
  body: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE messages SET body = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [messageId, body],
    client,
  );
}

/**
 * Soft-deletes a message.
 *
 * The row stays, and keeps its seq. Removing it would tear a hole in the
 * sequence, and a reconnecting client would wait forever for the number that no
 * longer exists.
 */
export async function softDeleteMessage(messageId: string, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE messages SET deleted_at = now(), body = NULL WHERE id = $1 AND deleted_at IS NULL`,
    [messageId],
    client,
  );
}

// --- read state -------------------------------------------------------------

/**
 * Advances a read position.
 *
 * `GREATEST` rather than assignment: read receipts arrive out of order all the
 * time, and a late one carrying a lower seq must not rewind the position and
 * resurrect an unread badge the user has already cleared. Clamped to the
 * conversation's head so a client cannot mark itself read past the end and
 * silence messages it has never seen.
 */
export async function markRead(
  conversationId: string,
  userId: string,
  seq: number,
  client?: Sql,
): Promise<{ last_read_seq: string; unread: string } | null> {
  return queryOne<{ last_read_seq: string; unread: string }>(
    `UPDATE conversation_members cm
     SET last_read_seq = LEAST(GREATEST(cm.last_read_seq, $3::bigint), c.last_seq),
         last_delivered_seq = GREATEST(cm.last_delivered_seq,
                                       LEAST(GREATEST(cm.last_read_seq, $3::bigint), c.last_seq))
     FROM conversations c
     WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND c.id = cm.conversation_id
     RETURNING cm.last_read_seq::text AS last_read_seq,
               GREATEST(0, c.last_seq - cm.last_read_seq)::text AS unread`,
    [conversationId, userId, seq],
    client,
  );
}

/** Everyone who should receive a realtime frame for this conversation. */
export async function listMemberIds(
  conversationId: string,
  client?: Sql,
): Promise<string[]> {
  const rows = await queryRows<{ user_id: string }>(
    `SELECT user_id FROM conversation_members
     WHERE conversation_id = $1 AND left_at IS NULL`,
    [conversationId],
    client,
  );
  return rows.map((row) => row.user_id);
}

/** The counterparty of a direct conversation, for the block check. */
export async function findCounterpart(
  conversationId: string,
  viewerId: string,
  client?: Sql,
): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    `SELECT cm.user_id FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.conversation_id = $1 AND cm.user_id <> $2 AND c.kind = 'direct'
     LIMIT 1`,
    [conversationId, viewerId],
    client,
  );
  return row?.user_id ?? null;
}

export async function findMembership(
  conversationId: string,
  userId: string,
  client?: Sql,
): Promise<ConversationMembership | null> {
  const row = await queryOne<{ role: MembershipRole; left_at: Date | null }>(
    `SELECT role, left_at FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
    client,
  );
  return row ? { role: row.role, leftAt: row.left_at } : null;
}
