import { z } from 'zod';
import {
  contentKindSchema,
  uuidSchema,
  visibilitySchema,
} from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';
import { fileRefSchema, MAX_MEDIA_PER_POST } from './files.contract.js';

/**
 * Content contract.
 *
 * One response shape for every feed object, matching the `content_items` spine.
 * Per-kind payload hangs off optional fields, so a client renders the common
 * card and switches only on `kind` for the extra part.
 */

export const reactionKindSchema = z.enum([
  'like',
  'helpful',
  'insightful',
  'celebrate',
  'curious',
]);
export type ReactionKind = z.infer<typeof reactionKindSchema>;

export const topicRefSchema = z.object({
  id: uuidSchema,
  nameAr: z.string(),
  nameEn: z.string(),
});

/**
 * The academic context a piece of content was published into — not the
 * author's current context. Content keeps the context it was published in.
 */
export const contentAcademicSchema = z.object({
  courseId: uuidSchema.nullable(),
  courseName: z.string().nullable(),
  subjectId: uuidSchema.nullable(),
  subjectName: z.string().nullable(),
  topics: z.array(topicRefSchema),
});

export const contentContainerSchema = z.object({
  kind: z.enum(['community', 'group', 'classroom']),
  id: uuidSchema,
  name: z.string(),
});

export const contentCountsSchema = z.object({
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  bookmarks: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
});

/**
 * Everything the viewer needs to render affordances without inferring
 * permissions client-side. A client that has to guess whether the delete button
 * should appear will eventually guess wrong.
 */
export const contentViewerStateSchema = z.object({
  reaction: reactionKindSchema.nullable(),
  hasBookmarked: z.boolean(),
  hasViewed: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canComment: z.boolean(),
  isAuthor: z.boolean(),
});

export const contentItemSchema = z.object({
  id: uuidSchema,
  kind: contentKindSchema,
  author: profileSummarySchema,
  body: z.string().nullable(),
  media: z.array(fileRefSchema),
  academic: contentAcademicSchema,
  container: contentContainerSchema.nullable(),
  visibility: visibilitySchema,
  counts: contentCountsSchema,
  viewer: contentViewerStateSchema,
  isPinned: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

// --- requests ---------------------------------------------------------------

/**
 * Post creation.
 *
 * Note what is absent: no author id, no academic context, no counters. Identity
 * comes from the token and the academic context is copied from the author's
 * profile server-side. A client that could supply either could publish as
 * someone else, or into a cohort it does not belong to.
 */
export const createPostRequestSchema = z
  .object({
    body: z.string().trim().max(10_000).optional(),
    mediaFileIds: z.array(uuidSchema).max(MAX_MEDIA_PER_POST).default([]),
    /** Defaults to the author's `defaultPostVisibility` privacy setting. */
    visibility: visibilitySchema.optional(),
    courseId: uuidSchema.optional(),
    subjectId: uuidSchema.optional(),
    topicIds: z.array(uuidSchema).max(10).default([]),
    communityId: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
  })
  .refine((value) => Boolean(value.body?.length) || value.mediaFileIds.length > 0, {
    message: 'A post needs either text or media.',
    path: ['body'],
  })
  .refine((value) => !(value.communityId && value.groupId), {
    message: 'Content belongs to at most one container.',
    path: ['communityId'],
  });
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

export const updatePostRequestSchema = z.object({
  body: z.string().trim().max(10_000).nullable().optional(),
  topicIds: z.array(uuidSchema).max(10).optional(),
  visibility: visibilitySchema.optional(),
});
export type UpdatePostRequest = z.infer<typeof updatePostRequestSchema>;

// --- feed -------------------------------------------------------------------

export const feedScopeSchema = z.enum([
  /** Ranked cohort feed — the default Home experience. */
  'home',
  /** Strictly chronological. Used by container views, where ranking would hide replies. */
  'recent',
  /** A single author's content. */
  'author',
  /** The viewer's bookmarks. */
  'saved',
]);
export type FeedScope = z.infer<typeof feedScopeSchema>;

export const feedQuerySchema = z.object({
  scope: feedScopeSchema.default('home'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  authorHandle: z.string().max(30).optional(),
  courseId: uuidSchema.optional(),
  topicId: uuidSchema.optional(),
  communityId: uuidSchema.optional(),
  groupId: uuidSchema.optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const feedPageSchema = z.object({
  items: z.array(contentItemSchema),
  nextCursor: z.string().nullable(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

// --- interactions -----------------------------------------------------------

export const setReactionRequestSchema = z.object({
  kind: reactionKindSchema.default('like'),
});

export const reactionResultSchema = z.object({
  reaction: reactionKindSchema.nullable(),
  likeCount: z.number().int().nonnegative(),
});

export const bookmarkRequestSchema = z.object({
  collection: z.string().trim().max(60).nullable().optional(),
});

export const bookmarkResultSchema = z.object({
  hasBookmarked: z.boolean(),
  bookmarkCount: z.number().int().nonnegative(),
});

export const markViewedRequestSchema = z.object({
  /** 0..1 for video; omitted for text and images. */
  completion: z.number().min(0).max(1).optional(),
});
