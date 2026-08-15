import { z } from 'zod';
import { uuidSchema } from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';
import { reactionKindSchema } from './content.contract.js';

/**
 * Comments, reports, and the social graph edges.
 */

// --- comments ---------------------------------------------------------------

/**
 * A comment without its reply preview.
 *
 * Threads are one level deep by design (see `createCommentRequestSchema`), so
 * this is deliberately NOT a recursive schema: a reply can never itself carry
 * replies. Modelling it recursively would advertise a nesting depth the API
 * does not produce and the UI could not render.
 */
const commentBaseSchema = z.object({
  id: uuidSchema,
  contentId: uuidSchema,
  parentId: uuidSchema.nullable(),
  author: profileSummarySchema,
  body: z.string(),
  likeCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  isAccepted: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  viewer: z.object({
    reaction: reactionKindSchema.nullable(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
  }),
});

export const commentSchema = commentBaseSchema.extend({
  /**
   * A bounded preview of replies, so a thread renders in one request rather
   * than one request per comment. The full set is fetched by asking for this
   * comment's own children.
   */
  replies: z.array(commentBaseSchema).optional(),
});
export type Comment = z.infer<typeof commentSchema>;

export const createCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  /**
   * Threads are one level deep. Replying to a reply attaches to the same
   * top-level comment: unbounded nesting is unreadable on a phone and makes
   * every read query recursive.
   */
  parentId: uuidSchema.optional(),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const updateCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listCommentsQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const commentPageSchema = z.object({
  items: z.array(commentSchema),
  nextCursor: z.string().nullable(),
});
export type CommentPage = z.infer<typeof commentPageSchema>;

// --- reports (§39) ----------------------------------------------------------

export const reportReasonSchema = z.enum([
  'spam',
  'harassment',
  'hate',
  'sexual',
  'violence',
  'misinformation',
  'academic_dishonesty',
  'copyright',
  'other',
]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * What can be reported.
 *
 * `message` was added for App Review Guideline 1.2: a direct message is where
 * harassment is most private and least visible to anyone else, so an app that
 * can report a public post but not a DM has the reporting capability pointed
 * away from the problem.
 */
export const reportTargetSchema = z.enum([
  'content',
  'comment',
  'message',
  'profile',
  'group',
  'community',
]);
export type ReportTargetType = z.infer<typeof reportTargetSchema>;

export const createReportRequestSchema = z.object({
  targetType: reportTargetSchema,
  targetId: uuidSchema,
  reason: reportReasonSchema,
  details: z.string().trim().max(2000).optional(),
});
export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;

export const reportAcknowledgementSchema = z.object({
  id: uuidSchema,
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  createdAt: z.string(),
});

// --- social graph (§11, §40) ------------------------------------------------

export const relationshipSchema = z.object({
  userId: uuidSchema,
  isFollowing: z.boolean(),
  isFollowedBy: z.boolean(),
  isBlocked: z.boolean(),
  isMuted: z.boolean(),
  followerCount: z.number().int().nonnegative(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const muteTargetSchema = z.enum(['user', 'conversation', 'group', 'community', 'topic']);

export const createMuteRequestSchema = z.object({
  targetType: muteTargetSchema,
  targetId: uuidSchema,
  /** Null means indefinite. */
  expiresAt: z.string().nullable().optional(),
});

export const listFollowsQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const profileSummaryPageSchema = z.object({
  items: z.array(profileSummarySchema),
  nextCursor: z.string().nullable(),
});
