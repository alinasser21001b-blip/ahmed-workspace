import type { Comment, CommentPage, CreateCommentRequest, Locale, ReactionKind } from '@sos/contracts';
import {
  canViewContent,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  isPlatformAdmin,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import { recordAnalytics, recordLearningEvent } from '../analytics/events.service.js';
import * as repo from './comments.repository.js';
import * as contentRepo from './content.repository.js';

/**
 * Comment business logic.
 */

/** Replies shown inline before the client has to ask for more. */
const REPLY_PREVIEW_COUNT = 3;

/**
 * A comment long enough to plausibly be a contribution rather than an
 * acknowledgement. "شكرا" is not academic discussion, and counting it as one
 * would inflate the north-star metric with politeness (§84).
 */
const SUBSTANTIVE_COMMENT_LENGTH = 40;

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toComment(
  row: repo.CommentRow,
  actor: Actor,
  locale: Locale,
  replies?: Comment[],
): Comment {
  const isAuthor = row.author_id === actor.userId;
  return {
    id: row.id,
    contentId: row.content_id,
    parentId: row.parent_id,
    author: {
      userId: row.author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url,
      verificationLevel: row.author_verification_level,
      stageName: localised(row.author_stage_name_ar, row.author_stage_name_en, locale),
      collegeName: localised(row.author_college_name_ar, row.author_college_name_en, locale),
    },
    body: row.body,
    likeCount: row.like_count,
    replyCount: row.reply_count,
    isAccepted: row.is_accepted,
    editedAt: row.edited_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    viewer: {
      reaction: row.viewer_reaction,
      canEdit: isAuthor,
      canDelete: isAuthor || isPlatformAdmin(actor),
    },
    ...(replies ? { replies } : {}),
  };
}

/** Commenting requires being able to read the thing being commented on. */
async function assertCanRead(actor: Actor, contentId: string): Promise<void> {
  const ref = await contentRepo.loadContentRef(contentId);
  if (!ref || !canViewContent(actor, ref).allowed) throw errors.notFound('content');
}

export async function createComment(
  actor: Actor,
  contentId: string,
  input: CreateCommentRequest,
  locale: Locale,
): Promise<Comment> {
  if (actor.status !== 'active') throw errors.accountSuspended(actor.status);

  const ref = await contentRepo.loadContentRef(contentId);
  if (!ref || !canViewContent(actor, ref).allowed) throw errors.notFound('content');

  /*
   * Threads are one level deep. A reply to a reply attaches to the same
   * top-level comment rather than nesting further: unbounded nesting is
   * unreadable on a phone and turns every thread read into a recursive query.
   */
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await repo.loadCommentOwner(input.parentId);
    if (!parent || parent.contentId !== contentId) {
      throw errors.notFound('comment');
    }
    parentId = parent.parentId ?? parent.id;
  }

  const commentId = await withTransaction(async (client) => {
    const created = await repo.insertComment(
      { contentId, authorId: actor.userId, parentId, body: input.body },
      client,
    );

    await recordAnalytics(
      'comment_created',
      actor.userId,
      { contentId, commentId: created.id, isReply: parentId !== null },
      client,
    );

    /*
     * A substantive reply on content with academic context is a meaningful
     * learning action (§84). This is the edge that makes the social layer feed
     * the Learning Graph rather than sitting beside it.
     */
    if (ref.courseId && input.body.trim().length >= SUBSTANTIVE_COMMENT_LENGTH) {
      await recordLearningEvent(
        {
          userId: actor.userId,
          kind: 'academic_discussion_participated',
          courseId: ref.courseId,
          subjectRefKind: 'content',
          subjectRefId: contentId,
        },
        client,
      );
    }

    return created.id;
  });

  const row = await repo.findCommentById(commentId, actor.userId);
  if (!row) throw errors.internal();
  return toComment(row, actor, locale);
}

export async function listComments(
  actor: Actor,
  contentId: string,
  query: { cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<CommentPage> {
  await assertCanRead(actor, contentId);

  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const excluded = visibilityScopesFor(actor).excludedUserIds;

  const rows = await repo.listTopLevelComments(
    contentId,
    actor.userId,
    excluded,
    cursor?.kind === 'time' ? { createdAt: cursor.t, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  // One extra query for all replies rather than one per comment: a thread of
  // twenty comments must not become twenty-one round trips.
  const replyRows = await repo.listRepliesFor(
    page.filter((r) => r.reply_count > 0).map((r) => r.id),
    actor.userId,
    excluded,
    REPLY_PREVIEW_COUNT,
  );

  const repliesByParent = new Map<string, Comment[]>();
  for (const reply of replyRows) {
    if (!reply.parent_id) continue;
    const bucket = repliesByParent.get(reply.parent_id) ?? [];
    bucket.push(toComment(reply, actor, locale));
    repliesByParent.set(reply.parent_id, bucket);
  }

  const last = page[page.length - 1];
  return {
    items: page.map((row) => toComment(row, actor, locale, repliesByParent.get(row.id))),
    nextCursor:
      hasMore && last
        ? encodeCursor({ kind: 'time', t: last.created_at.getTime(), id: last.id })
        : null,
  };
}

export async function updateComment(
  actor: Actor,
  commentId: string,
  body: string,
  locale: Locale,
): Promise<Comment> {
  const existing = await repo.loadCommentOwner(commentId);
  if (!existing) throw errors.notFound('comment');
  await assertCanRead(actor, existing.contentId);

  if (existing.authorId !== actor.userId) throw errors.forbidden('not_author');

  await repo.updateComment(commentId, actor.userId, body);

  const row = await repo.findCommentById(commentId, actor.userId);
  if (!row) throw errors.notFound('comment');
  return toComment(row, actor, locale);
}

export async function deleteComment(actor: Actor, commentId: string): Promise<void> {
  const existing = await repo.loadCommentOwner(commentId);
  if (!existing) throw errors.notFound('comment');

  const content = await contentRepo.loadContentRef(existing.contentId);
  if (!content || !canViewContent(actor, content).allowed) throw errors.notFound('comment');

  // The comment's author, the content's author, or a platform admin. A post's
  // author moderating their own thread is the cheapest moderation there is.
  const permitted =
    existing.authorId === actor.userId ||
    content.authorId === actor.userId ||
    isPlatformAdmin(actor);
  if (!permitted) throw errors.forbidden('not_permitted');

  await withTransaction((client) =>
    repo.softDeleteComment(commentId, existing.contentId, existing.parentId, client),
  );
}

export async function setCommentReaction(
  actor: Actor,
  commentId: string,
  kind: ReactionKind,
): Promise<{ reaction: ReactionKind; likeCount: number }> {
  const existing = await repo.loadCommentOwner(commentId);
  if (!existing) throw errors.notFound('comment');
  await assertCanRead(actor, existing.contentId);

  const likeCount = await withTransaction((client) =>
    repo.setCommentReaction(commentId, actor.userId, kind, client),
  );
  return { reaction: kind, likeCount };
}

export async function removeCommentReaction(
  actor: Actor,
  commentId: string,
): Promise<{ reaction: null; likeCount: number }> {
  const existing = await repo.loadCommentOwner(commentId);
  if (!existing) throw errors.notFound('comment');
  await assertCanRead(actor, existing.contentId);

  const likeCount = await withTransaction((client) =>
    repo.removeCommentReaction(commentId, actor.userId, client),
  );
  return { reaction: null, likeCount };
}
