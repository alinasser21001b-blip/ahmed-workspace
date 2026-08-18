import { z } from 'zod';
import {
  isoDateTimeSchema,
  membershipRoleSchema,
  uuidSchema,
} from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';

/**
 * Messaging.
 *
 * Three fields carry the entire delivery contract, and every shape below exists
 * to keep them honest:
 *
 *   `seq`               server-assigned, dense, unique per conversation. The
 *                       ONLY ordering. Client clocks are not an ordering — they
 *                       disagree across devices, time zones and a phone whose
 *                       user changed the date.
 *   `clientMessageId`   minted by the sender before the first attempt. Unique
 *                       per conversation. A retry after a dropped response
 *                       returns the row that already exists.
 *   `lastReadSeq`       one integer per member. Read receipts and unread counts
 *                       both derive from it, so they cannot disagree, and
 *                       neither costs a row per message per user.
 */

export const conversationKindSchema = z.enum(['direct', 'group']);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

export const messageKindSchema = z.enum([
  'text',
  'image',
  'file',
  'audio',
  'video',
  'system',
  'share',
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

/**
 * A sequence number.
 *
 * `bigint` in the database, and a JavaScript number here: the safe-integer
 * ceiling is 2^53, which is 9 quadrillion messages in one conversation. The
 * database column stays wide because widening one later is a rewrite.
 */
export const seqSchema = z.number().int().nonnegative();

/**
 * Why `canSend` is false, when it is — so the client can say what actually
 * happened (blocked, removed, restricted) instead of a single fixed excuse
 * that is true for none of them. Null whenever `canSend` is true.
 */
export const cannotSendReasonSchema = z.enum(['account_restricted', 'not_a_member', 'blocked']);
export type CannotSendReason = z.infer<typeof cannotSendReasonSchema>;

/** What the reader may do with this conversation, as the policy computed it. */
export const conversationViewerStateSchema = z.object({
  role: membershipRoleSchema,
  canRead: z.boolean(),
  canSend: z.boolean(),
  cannotSendReason: cannotSendReasonSchema.nullable(),
  /** Their own read position. Everything unread is derived from it. */
  lastReadSeq: seqSchema,
  unreadCount: z.number().int().nonnegative(),
  muted: z.boolean(),
});
export type ConversationViewerState = z.infer<typeof conversationViewerStateSchema>;

export const conversationSchema = z.object({
  id: uuidSchema,
  kind: conversationKindSchema,
  /**
   * Resolved for display: a direct conversation is titled by the other person,
   * a group conversation by its group. The server resolves it because "the
   * other person" is a different person for each reader.
   */
  title: z.string(),
  avatarUrl: z.string().nullable(),
  groupId: uuidSchema.nullable(),
  /** The counterparty of a direct conversation. Null for a group. */
  counterpart: profileSummarySchema.nullable(),
  lastSeq: seqSchema,
  lastMessageAt: isoDateTimeSchema.nullable(),
  /**
   * A preview of the most recent message.
   *
   * Null when there is none — never a placeholder string, and never the body of
   * a message the reader may not see.
   */
  lastMessagePreview: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  viewer: conversationViewerStateSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageAttachmentSchema = z.object({
  fileId: uuidSchema,
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const messageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  seq: seqSchema,
  /**
   * Echoed back so the sender can reconcile the optimistic row it already
   * rendered, instead of appending a duplicate beside it.
   */
  clientMessageId: uuidSchema,
  kind: messageKindSchema,
  /** Null for a deleted message, which keeps its seq so ordering survives. */
  body: z.string().nullable(),
  author: profileSummarySchema.nullable(),
  replyToId: uuidSchema.nullable(),
  attachments: z.array(messageAttachmentSchema),
  editedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Message = z.infer<typeof messageSchema>;

/**
 * A page of messages.
 *
 * Paginated by `seq`, not by timestamp and not by offset. Two messages can share
 * a millisecond; none can share a seq. `hasMore` plus a `nextBeforeSeq` is the
 * whole protocol.
 */
export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  /** Pass as `beforeSeq` to fetch the next older page. Null at the beginning. */
  nextBeforeSeq: seqSchema.nullable(),
  /** The conversation's head at the time of this read. */
  lastSeq: seqSchema,
});
export type MessagePage = z.infer<typeof messagePageSchema>;

export const listConversationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
  /** Across every conversation. The badge on the tab. */
  totalUnread: z.number().int().nonnegative(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

export const listMessagesQuerySchema = z.object({
  /** Older than this seq — backwards scroll. */
  beforeSeq: z.coerce.number().int().nonnegative().optional(),
  /** Newer than this seq — the reconnect gap replay. */
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/**
 * Sending.
 *
 * `clientMessageId` is required, not optional. Making it optional would mean
 * every caller that forgot it got at-least-once delivery with duplicates, and
 * the ones that remembered got exactly-once — a difference no test would catch
 * until a user saw the same message twice.
 */
export const sendMessageRequestSchema = z
  .object({
    clientMessageId: uuidSchema,
    kind: messageKindSchema.default('text'),
    body: z.string().trim().min(1).max(8000).nullable().default(null),
    replyToId: uuidSchema.nullable().default(null),
    /** Uploaded first, referenced here. Bytes never travel through this API. */
    attachmentFileIds: z.array(uuidSchema).max(10).default([]),
  })
  .refine((value) => value.body !== null || value.attachmentFileIds.length > 0, {
    message: 'A message needs a body or an attachment.',
    path: ['body'],
  });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

/**
 * The send response.
 *
 * `deduplicated` tells the client that its retry matched an existing row rather
 * than creating one. The client does not need it to behave correctly — it
 * reconciles on `clientMessageId` either way — but a delivery guarantee that
 * cannot be observed cannot be tested, and this is how the integration test
 * observes it.
 */
export const sendMessageResponseSchema = z.object({
  message: messageSchema,
  deduplicated: z.boolean(),
});
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const markReadRequestSchema = z.object({
  /** Read up to and including this seq. Monotonic: never moves backwards. */
  seq: seqSchema,
});
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>;

export const markReadResponseSchema = z.object({
  lastReadSeq: seqSchema,
  unreadCount: z.number().int().nonnegative(),
});
export type MarkReadResponse = z.infer<typeof markReadResponseSchema>;

export const createConversationRequestSchema = z.object({
  /** A direct conversation with this student. Idempotent per unordered pair. */
  recipientHandle: z.string().optional(),
  /** Or the conversation of a group the caller belongs to. */
  groupId: uuidSchema.optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const updateMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});
export type UpdateMessageRequest = z.infer<typeof updateMessageRequestSchema>;

// --- realtime ---------------------------------------------------------------

/**
 * The realtime protocol.
 *
 * The transport carries **notifications about committed state**, never the
 * commit itself. A client sends over HTTP, the database assigns the seq inside
 * a transaction, and the socket announces what was written. The inverse —
 * client → socket → hope it persisted — is how a chat loses messages when a
 * process restarts between the ack and the write.
 *
 * So there is no `message.send` frame. Sending is `POST /messages`, which is
 * also what makes retries idempotent and offline sends replayable.
 */
export const realtimeClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), conversationId: uuidSchema }),
  z.object({ type: z.literal('unsubscribe'), conversationId: uuidSchema }),
  /** Ephemeral, never persisted, expires on its own. */
  z.object({ type: z.literal('typing'), conversationId: uuidSchema, typing: z.boolean() }),
  /** Reconnect: "I have up to `lastSeq`, send me the gap." */
  z.object({ type: z.literal('resync'), conversationId: uuidSchema, lastSeq: seqSchema }),
  z.object({ type: z.literal('ping') }),
]);
export type RealtimeClientFrame = z.infer<typeof realtimeClientFrameSchema>;

export const realtimeServerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), userId: uuidSchema }),
  z.object({ type: z.literal('subscribed'), conversationId: uuidSchema, lastSeq: seqSchema }),
  z.object({ type: z.literal('message.new'), message: messageSchema }),
  z.object({ type: z.literal('message.updated'), message: messageSchema }),
  z.object({
    type: z.literal('message.read'),
    conversationId: uuidSchema,
    userId: uuidSchema,
    seq: seqSchema,
  }),
  z.object({
    type: z.literal('typing'),
    conversationId: uuidSchema,
    userId: uuidSchema,
    typing: z.boolean(),
  }),
  z.object({
    type: z.literal('presence'),
    userId: uuidSchema,
    status: z.enum(['online', 'away', 'offline']),
  }),
  /** The gap replay, in one frame, ordered by seq. */
  z.object({
    type: z.literal('resync'),
    conversationId: uuidSchema,
    messages: z.array(messageSchema),
    lastSeq: seqSchema,
  }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type RealtimeServerFrame = z.infer<typeof realtimeServerFrameSchema>;
