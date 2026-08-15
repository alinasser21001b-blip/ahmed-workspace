import type {
  Conversation,
  ConversationPage,
  CreateConversationRequest,
  Locale,
  MarkReadResponse,
  Message,
  MessagePage,
  SendMessageRequest,
  SendMessageResponse,
} from '@sos/contracts';
import {
  canDeleteMessage,
  canEditMessage,
  canMarkRead,
  canMessage,
  canReadConversation,
  canSendMessage,
  canStartDirectConversation,
  canViewConversation,
  conversationCapabilities,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  unreadCount,
  type Actor,
} from '@sos/core';
import { withTransaction, type Sql } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as moderationGate from '../moderation/moderation.service.js';
import { recordAnalytics } from '../analytics/events.service.js';
import { emit } from '../events/events.service.js';
import * as files from '../files/files.repository.js';
import { signMediaUrl } from '../files/signed-url.js';
import * as groups from '../groups/groups.repository.js';
import * as users from '../users/users.repository.js';
import { publish } from './realtime.js';
import * as repo from './conversations.repository.js';

/**
 * Messaging business logic.
 *
 * The shape of every write in this module:
 *
 *     command → policy → transaction (database assigns seq) → commit
 *                                                          → publish
 *
 * The publish happens **after** the transaction, and only after it commits. A
 * realtime frame is an announcement about state that exists; sending it from
 * inside the transaction would broadcast a message that a rollback then erased,
 * and every subscriber would hold a message the server does not have.
 *
 * Reads and writes both go through HTTP. The socket carries notifications, not
 * commands — see `realtime.ts`.
 */

function toMessage(row: repo.MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: Number(row.seq),
    clientMessageId: row.client_message_id,
    kind: row.kind,
    body: row.body,
    author: row.author_handle
      ? {
          userId: row.sender_id!,
          handle: row.author_handle,
          displayName: row.author_display_name!,
          avatarUrl: row.author_avatar_url,
          verificationLevel: row.author_verification_level!,
          stageName: null,
          collegeName: null,
        }
      : null,
    replyToId: row.reply_to_id,
    attachments: row.attachments.map((attachment) => ({
      fileId: attachment.fileId,
      // Signed at read time, short-lived, and minted only for a caller who has
      // already passed the conversation gate.
      url: signMediaUrl(attachment.fileId).url,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
    })),
    editedAt: row.edited_at?.toISOString() ?? null,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function previewOf(row: repo.ConversationRow): string | null {
  if (row.last_message_body) return row.last_message_body.slice(0, 140);
  if (!row.last_message_kind) return null;
  // A non-text message still needs a preview, and its body is not one.
  return `[${row.last_message_kind}]`;
}

function toConversation(row: repo.ConversationRow, actor: Actor, _locale: Locale): Conversation {
  const membership = repo.toMembership(row);
  const caps = conversationCapabilities(
    actor,
    repo.toConversationRef(row),
    membership,
    row.counterpart_user_id,
  );

  const lastSeq = Number(row.last_seq);
  const lastReadSeq = Number(row.viewer_last_read_seq ?? 0);

  return {
    id: row.id,
    kind: row.kind,
    // A direct conversation is titled by whoever the reader is not.
    title: row.kind === 'direct' ? (row.counterpart_display_name ?? '') : (row.group_name ?? row.title ?? ''),
    avatarUrl: row.kind === 'direct' ? row.counterpart_avatar_url : row.avatar_url,
    groupId: row.group_id,
    counterpart: row.counterpart_user_id
      ? {
          userId: row.counterpart_user_id,
          handle: row.counterpart_handle!,
          displayName: row.counterpart_display_name!,
          avatarUrl: row.counterpart_avatar_url,
          verificationLevel: row.counterpart_verification_level!,
          stageName: null,
          collegeName: null,
        }
      : null,
    lastSeq,
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    lastMessagePreview: previewOf(row),
    createdAt: row.created_at.toISOString(),
    viewer: {
      role: membership?.role ?? 'member',
      canRead: caps.canRead.allowed,
      canSend: caps.canSend.allowed,
      lastReadSeq,
      unreadCount: unreadCount(lastSeq, lastReadSeq),
      muted: row.viewer_muted_until !== null && row.viewer_muted_until > new Date(),
    },
  };
}

/**
 * Loads a conversation the actor is allowed to know exists.
 *
 * 404, never 403. A conversation id that returns "forbidden" confirms that a
 * conversation with that id exists — which, given ids are the only thing an
 * attacker can enumerate, is the entire attack.
 */
async function loadVisible(actor: Actor, conversationId: string): Promise<repo.ConversationRow> {
  const row = await repo.findConversationById(conversationId, actor.userId);
  if (!row) throw errors.notFound('conversation');

  const decision = canViewConversation(actor, repo.toConversationRef(row), repo.toMembership(row));
  if (!decision.allowed) throw errors.notFound('conversation');
  return row;
}

export async function getConversation(
  actor: Actor,
  conversationId: string,
  locale: Locale,
): Promise<Conversation> {
  return toConversation(await loadVisible(actor, conversationId), actor, locale);
}

export async function listConversations(
  actor: Actor,
  query: { cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<ConversationPage> {
  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const rows = await repo.listConversations(
    actor.userId,
    cursor?.kind === 'time' ? { lastMessageAt: cursor.t, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toConversation(row, actor, locale)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            kind: 'time',
            t: (last.last_message_at ?? last.created_at).getTime(),
            id: last.id,
          })
        : null,
    totalUnread: await repo.totalUnread(actor.userId),
  };
}

/**
 * Opens a conversation — a direct one with another student, or a group's.
 *
 * Idempotent in both cases. Opening a chat twice is what a user does when the
 * first tap did not appear to work, and it must not produce two threads.
 */
export async function createConversation(
  actor: Actor,
  input: CreateConversationRequest,
  locale: Locale,
): Promise<Conversation> {
  if (input.recipientHandle && input.groupId) {
    throw errors.validation([
      { path: 'recipientHandle', message: 'Open either a direct conversation or a group one.' },
    ]);
  }

  if (input.recipientHandle) {
    const profile = await users.findProfileByHandle(input.recipientHandle);
    if (!profile) throw errors.notFound('profile');

    const target = await users.loadTargetUserRef(profile.user_id, actor.userId);
    if (!target) throw errors.notFound('profile');

    /*
     * `canMessage` resolves the recipient's privacy scope — the existing,
     * tested gate for "may I open a thread with this person" — and its verdict
     * feeds the conversation policy rather than being reimplemented there.
     * Composition, not duplication: the privacy question has one answer, and
     * `canStartDirectConversation` adds only what is specific to conversations.
     */
    const decision = canStartDirectConversation(actor, {
      userId: profile.user_id,
      allowsMessages: canMessage(actor, target).allowed,
    });
    // 404 for a target that must not be confirmed to exist; 403 when the caller
    // already knows they exist and simply may not write to them.
    if (!decision.allowed) {
      throw decision.reason === 'blocked'
        ? errors.notFound('profile')
        : errors.forbidden(decision.reason);
    }

    const { id, created } = await withTransaction(async (client) => {
      const result = await repo.findOrCreateDirect(actor.userId, profile.user_id, client);
      if (result.created) {
        await emit(client, {
          kind: 'conversation.created',
          actorId: actor.userId,
          subjectId: profile.user_id,
          targetType: 'conversation',
          targetId: result.id,
          payload: { kind: 'direct' },
        });
        await recordAnalytics('conversation_created', actor.userId, { kind: 'direct' }, client);
      }
      return result;
    });
    void created;
    return getConversation(actor, id, locale);
  }

  if (input.groupId) {
    // Group membership is the gate, and it is checked against the group rather
    // than the conversation: the conversation may not exist yet.
    const group = await groups.findGroupById(input.groupId, actor.userId);
    if (!group) throw errors.notFound('group');
    const membership = groups.toMembership(group);
    if (membership?.status !== 'active') throw errors.notFound('group');

    const { id } = await withTransaction(async (client) => {
      const result = await repo.findOrCreateGroupConversation(input.groupId!, actor.userId, client);
      if (result.created) {
        await emit(client, {
          kind: 'conversation.created',
          actorId: actor.userId,
          targetType: 'conversation',
          targetId: result.id,
          payload: { kind: 'group', groupId: input.groupId },
        });
      }
      return result;
    });
    return getConversation(actor, id, locale);
  }

  throw errors.validation([
    { path: 'recipientHandle', message: 'A recipient handle or a group id is required.' },
  ]);
}

// --- messages ---------------------------------------------------------------

export async function listMessages(
  actor: Actor,
  conversationId: string,
  query: { beforeSeq?: number | undefined; afterSeq?: number | undefined; limit: number },
): Promise<MessagePage> {
  const row = await loadVisible(actor, conversationId);
  const decision = canReadConversation(actor, repo.toConversationRef(row), repo.toMembership(row));
  if (!decision.allowed) throw errors.notFound('conversation');

  const rows = await repo.listMessages(
    conversationId,
    { beforeSeq: query.beforeSeq, afterSeq: query.afterSeq },
    query.limit + 1,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  /*
   * Backwards pages come out newest-first from the query and are reversed here,
   * so the client always receives ascending seq and never has to know which
   * direction it asked in.
   */
  const ascending = query.afterSeq !== undefined ? page : [...page].reverse();
  const oldest = ascending[0];

  return {
    items: ascending.map(toMessage),
    // Only a backwards scroll has an older page to offer.
    nextBeforeSeq: hasMore && query.afterSeq === undefined && oldest ? Number(oldest.seq) : null,
    lastSeq: Number(row.last_seq),
  };
}

export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: SendMessageRequest,
): Promise<SendMessageResponse> {
  const row = await loadVisible(actor, conversationId);
  const conversation = repo.toConversationRef(row);
  const membership = repo.toMembership(row);

  const counterpart =
    conversation.kind === 'direct'
      ? (row.counterpart_user_id ?? (await repo.findCounterpart(conversationId, actor.userId)))
      : null;

  const decision = canSendMessage(actor, conversation, membership, counterpart);
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  /*
   * The moderation gate, on the private surface (Guideline 1.2).
   *
   * A direct message has no audience, so the spam rules — which exist to
   * protect one — do not run here. The rules that DO run are the ones about
   * harassment aimed at a person, and a DM is precisely where that happens:
   * refusing a slur or a threat in public and permitting it in a private
   * message would be a filter that protects bystanders rather than targets.
   */
  const moderation = await moderationGate.gate({
    userId: actor.userId,
    surface: 'message',
    audience: 'private',
    text: input.body,
  });

  const { messageId, seq, deduplicated } = await withTransaction(async (client) => {
    const result = await repo.insertMessage(
      {
        conversationId,
        senderId: actor.userId,
        clientMessageId: input.clientMessageId,
        kind: input.kind,
        body: input.body,
        replyToId: input.replyToId,
      },
      client,
    );

    /*
     * A deduplicated send does nothing else at all. It attaches no files, emits
     * no event, and publishes no frame — the original send already did. Without
     * this branch a retry would fan out a second notification for a message the
     * recipient already has.
     */
    if (!result.deduplicated) {
      /*
       * Attachments are references to files this student already uploaded.
       * Bytes never travel through this endpoint. The claim is atomic and
       * inside the same transaction as the message, so a message can never
       * reference a file it failed to claim — which would render as a broken
       * image for everyone who receives it.
       */
      if (input.attachmentFileIds.length > 0) {
        const claimed = await files.attachFilesToMessage(
          input.attachmentFileIds,
          actor.userId,
          client,
        );
        if (claimed.length !== new Set(input.attachmentFileIds).size) {
          throw errors.preconditionFailed(
            'One or more attachments are unavailable, already in use, or not yours.',
            { field: 'attachmentFileIds' },
          );
        }
        await repo.attachFiles(result.id, input.attachmentFileIds, client);
      }
      await emit(client, {
        kind: 'message.created',
        actorId: actor.userId,
        targetType: 'conversation',
        targetId: conversationId,
        payload: { messageId: result.id, seq: result.seq },
      });
    }

    return { messageId: result.id, seq: result.seq, deduplicated: result.deduplicated };
  });

  if (moderation.flagged && !deduplicated) {
    await moderationGate.linkFlaggedTarget({
      userId: actor.userId,
      surface: 'message',
      contentHash: moderation.contentHash,
      targetKind: 'message',
      targetId: messageId,
    });
  }

  const stored = await repo.findMessageById(messageId);
  if (!stored) throw errors.internal('message vanished after insert');
  const message = toMessage(stored);

  // After the commit, never before: a frame about a rolled-back write would
  // leave every subscriber holding a message the server does not have.
  if (!deduplicated) {
    publish(await repo.listMemberIds(conversationId), {
      type: 'message.new',
      message,
    });
  }

  void seq;
  return { message, deduplicated };
}

export async function markRead(
  actor: Actor,
  conversationId: string,
  seq: number,
): Promise<MarkReadResponse> {
  const row = await loadVisible(actor, conversationId);

  const decision = canMarkRead(
    actor,
    repo.toConversationRef(row),
    repo.toMembership(row),
    actor.userId,
  );
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  const result = await repo.markRead(conversationId, actor.userId, seq);
  if (!result) throw errors.notFound('conversation');

  const lastReadSeq = Number(result.last_read_seq);

  await withTransaction((client) =>
    emit(client, {
      kind: 'message.read',
      actorId: actor.userId,
      targetType: 'conversation',
      targetId: conversationId,
      payload: { seq: lastReadSeq },
    }),
  );

  publish(await repo.listMemberIds(conversationId), {
    type: 'message.read',
    conversationId,
    userId: actor.userId,
    seq: lastReadSeq,
  });

  return { lastReadSeq, unreadCount: Number(result.unread) };
}

export async function editMessage(
  actor: Actor,
  messageId: string,
  body: string,
): Promise<Message> {
  const stored = await repo.findMessageById(messageId);
  if (!stored) throw errors.notFound('message');

  // Conversation visibility first: a message id must not confirm its own
  // existence to someone outside the thread.
  const row = await loadVisible(actor, stored.conversation_id);
  void row;

  const decision = canEditMessage(actor, {
    id: stored.id,
    conversationId: stored.conversation_id,
    senderId: stored.sender_id,
    deletedAt: stored.deleted_at,
    createdAt: stored.created_at,
  });
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  await repo.updateMessageBody(messageId, body);

  const updated = await repo.findMessageById(messageId);
  if (!updated) throw errors.internal('message vanished after edit');
  const message = toMessage(updated);

  publish(await repo.listMemberIds(stored.conversation_id), {
    type: 'message.updated',
    message,
  });
  return message;
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  const stored = await repo.findMessageById(messageId);
  if (!stored) throw errors.notFound('message');

  const row = await loadVisible(actor, stored.conversation_id);

  const decision = canDeleteMessage(
    actor,
    {
      id: stored.id,
      conversationId: stored.conversation_id,
      senderId: stored.sender_id,
      deletedAt: stored.deleted_at,
      createdAt: stored.created_at,
    },
    repo.toMembership(row),
  );
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  await repo.softDeleteMessage(messageId);

  const updated = await repo.findMessageById(messageId);
  if (updated) {
    // The row keeps its seq and is broadcast as an update rather than removed:
    // a hole in the sequence would leave reconnecting clients waiting for a
    // number that no longer exists.
    publish(await repo.listMemberIds(stored.conversation_id), {
      type: 'message.updated',
      message: toMessage(updated),
    });
  }
}

/** The gap replay after a reconnect. Used by the realtime layer. */
export async function replayGap(
  actor: Actor,
  conversationId: string,
  afterSeq: number,
  limit = 200,
  client?: Sql,
): Promise<{ messages: Message[]; lastSeq: number } | null> {
  const row = await repo.findConversationById(conversationId, actor.userId, client);
  if (!row) return null;
  if (!canReadConversation(actor, repo.toConversationRef(row), repo.toMembership(row)).allowed) {
    return null;
  }

  const rows = await repo.listMessages(conversationId, { afterSeq }, limit, client);
  return { messages: rows.map(toMessage), lastSeq: Number(row.last_seq) };
}

/** Membership check for a realtime subscription. Same gate as the REST read. */
export async function canSubscribe(actor: Actor, conversationId: string): Promise<boolean> {
  const row = await repo.findConversationById(conversationId, actor.userId);
  if (!row) return false;
  return canViewConversation(actor, repo.toConversationRef(row), repo.toMembership(row)).allowed;
}
