import type {
  ContentItem,
  CreatePostRequest,
  FeedPage,
  FeedQuery,
  Locale,
  ReactionKind,
  UpdatePostRequest,
} from '@sos/contracts';
import {
  canCreateContent,
  canDeleteContent,
  canEditContent,
  canPostInCommunity,
  canPostInGroup,
  canViewContent,
  decodeCursor,
  impliedMembership,
  encodeCursor,
  InvalidCursorError,
  pinnedClock,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import { recordAnalytics } from '../analytics/events.service.js';
import * as files from '../files/files.service.js';
import { signMediaUrl } from '../files/signed-url.js';
import * as profiles from '../users/users.repository.js';
import * as repo from './content.repository.js';

/**
 * Content business logic.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

export function toContentItem(row: repo.ContentRow, actor: Actor | null, locale: Locale): ContentItem {
  const isAuthor = actor?.userId === row.author_id;

  const container =
    row.community_id !== null
      ? {
          kind: 'community' as const,
          id: row.community_id,
          name: localised(row.community_name_ar, row.community_name_en, locale) ?? '',
        }
      : row.group_id !== null
        ? { kind: 'group' as const, id: row.group_id, name: row.group_name ?? '' }
        : row.classroom_id !== null
          ? { kind: 'classroom' as const, id: row.classroom_id, name: '' }
          : null;

  return {
    id: row.id,
    kind: row.kind,
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
    // Signed at serialisation time, so a URL is always fresh when it reaches
    // the client rather than expiring in a cached response.
    media: row.media.map((file) => {
      const signed = signMediaUrl(file.id);
      return {
        id: file.id,
        mimeType: file.mimeType,
        sizeBytes: Number(file.sizeBytes),
        width: file.width ?? null,
        height: file.height ?? null,
        url: signed.url,
        expiresAt: signed.expiresAt,
      };
    }),
    academic: {
      courseId: row.course_id,
      courseName: localised(row.course_name_ar, row.course_name_en, locale),
      subjectId: row.subject_id,
      subjectName: localised(row.subject_name_ar, row.subject_name_en, locale),
      topics: row.topics,
    },
    container,
    visibility: row.visibility,
    counts: {
      likes: row.like_count,
      comments: row.comment_count,
      bookmarks: row.bookmark_count,
      views: row.view_count,
    },
    viewer: {
      reaction: row.viewer_reaction,
      hasBookmarked: row.viewer_bookmarked,
      hasViewed: row.seen,
      canEdit: isAuthor,
      canDelete: isAuthor || actor?.role === 'admin',
      canComment: actor !== null && actor.status === 'active',
      isAuthor,
    },
    isPinned: row.is_pinned,
    editedAt: row.edited_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Creates a post.
 *
 * The academic context is copied from the author's profile here, server-side.
 * A client cannot supply it, which is what stops a student publishing into a
 * cohort they do not belong to — and copying rather than joining is what makes
 * the post keep its context after the author moves up a stage (§10).
 */
export async function createPost(
  actor: Actor,
  input: CreatePostRequest,
  locale: Locale,
): Promise<ContentItem> {
  const gate = canCreateContent(actor);
  if (!gate.allowed) throw errors.forbidden(gate.reason);

  const profile = await profiles.findProfileByUserId(actor.userId);
  if (!profile || !profile.onboarding_completed) {
    throw errors.preconditionFailed('Complete your profile before posting.', {
      field: 'onboarding',
    });
  }

  const privacy = await profiles.getPrivacySettings(actor.userId);
  const visibility = input.visibility ?? privacy.defaultPostVisibility;

  /*
   * Container membership is checked here, not trusted from the request: posting
   * into a group you are not in would put your content behind a boundary you
   * cannot see past.
   *
   * It goes through the policy rather than reading `actor.groupIds` directly.
   * The two agreed, but a second implementation of a permission question is
   * exactly what ADR-0003 exists to forbid — and when group posting gains a
   * per-group rule, the version that is not the policy is the one that will be
   * missed.
   */
  if (input.groupId) {
    const decision = canPostInGroup(actor, impliedMembership(actor, input.groupId, 'group'));
    if (!decision.allowed) throw errors.forbidden(decision.reason);
  }
  if (input.communityId) {
    const decision = canPostInCommunity(
      actor,
      impliedMembership(actor, input.communityId, 'community'),
    );
    if (!decision.allowed) throw errors.forbidden(decision.reason);
  }
  if (input.courseId && !actor.courseIds.has(input.courseId)) {
    throw errors.forbidden('not_enrolled');
  }

  const contentId = await withTransaction(async (client) => {
    const created = await repo.insertContent(
      {
        kind: 'post',
        authorId: actor.userId,
        body: input.body ?? null,
        visibility,
        universityId: profile.university_id,
        collegeId: profile.college_id,
        programId: profile.program_id,
        stageId: profile.stage_id,
        courseId: input.courseId ?? null,
        subjectId: input.subjectId ?? null,
        communityId: input.communityId ?? null,
        groupId: input.groupId ?? null,
      },
      client,
    );

    if (input.mediaFileIds.length > 0) {
      // Claiming the files and linking them happen in the same transaction as
      // the post: a post that references media it failed to claim would render
      // as a broken image for everyone.
      await files.attachToContent(
        input.mediaFileIds,
        actor.userId,
        {
          visibility,
          courseId: input.courseId ?? null,
          communityId: input.communityId ?? null,
          groupId: input.groupId ?? null,
        },
        client,
      );
      await repo.attachMedia(created.id, input.mediaFileIds, client);
    }

    if (input.topicIds.length > 0) {
      await repo.replaceTopics(created.id, input.topicIds, client);
    }

    await recordAnalytics(
      'post_created',
      actor.userId,
      { contentId: created.id, hasMedia: input.mediaFileIds.length > 0, visibility },
      client,
    );

    return created.id;
  });

  const row = await repo.findContentById(contentId, actor.userId);
  if (!row) throw errors.internal();
  return toContentItem(row, actor, locale);
}

export async function getContent(
  actor: Actor | null,
  contentId: string,
  locale: Locale,
): Promise<ContentItem> {
  const ref = await repo.loadContentRef(contentId);
  if (!ref) throw errors.notFound('content');

  // Single-object access goes through the policy, which — unlike the feed —
  // honours the platform-admin bypass so a reported item can be reviewed.
  if (!canViewContent(actor, ref).allowed) throw errors.notFound('content');

  const row = await repo.findContentById(contentId, actor?.userId ?? null);
  if (!row) throw errors.notFound('content');
  return toContentItem(row, actor, locale);
}

export async function updatePost(
  actor: Actor,
  contentId: string,
  input: UpdatePostRequest,
  locale: Locale,
): Promise<ContentItem> {
  const ref = await repo.loadContentRef(contentId);
  if (!ref) throw errors.notFound('content');

  const decision = canEditContent(actor, ref);
  if (!decision.allowed) {
    // 404 rather than 403 when the actor could not see it in the first place,
    // so editing is not an existence oracle for private content.
    throw canViewContent(actor, ref).allowed
      ? errors.forbidden(decision.reason)
      : errors.notFound('content');
  }

  await withTransaction(async (client) => {
    await repo.updateContent(
      contentId,
      actor.userId,
      {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      },
      client,
    );
    if (input.topicIds) await repo.replaceTopics(contentId, input.topicIds, client);
  });

  const row = await repo.findContentById(contentId, actor.userId);
  if (!row) throw errors.notFound('content');
  return toContentItem(row, actor, locale);
}

export async function deletePost(actor: Actor, contentId: string): Promise<void> {
  const ref = await repo.loadContentRef(contentId);
  if (!ref) throw errors.notFound('content');

  if (!canDeleteContent(actor, ref).allowed) {
    throw canViewContent(actor, ref).allowed
      ? errors.forbidden('not_permitted')
      : errors.notFound('content');
  }

  await repo.softDeleteContent(contentId);
  await recordAnalytics('post_deleted', actor.userId, { contentId });
}

/**
 * Reads a page of the feed.
 *
 * The scoring clock is pinned into the cursor, so page two is scored against
 * page one's instant and an item cannot drift across the boundary and appear
 * twice.
 */
export async function listFeed(
  actor: Actor,
  query: FeedQuery,
  locale: Locale,
): Promise<FeedPage> {
  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const ordering = query.scope === 'home' ? 'rank' : 'recent';
  const pinnedNow = pinnedClock(cursor);

  let authorId: string | undefined;
  if (query.scope === 'author') {
    if (!query.authorHandle) {
      throw errors.validation([
        { path: 'authorHandle', message: 'An author handle is required for this scope.' },
      ]);
    }
    const author = await profiles.findProfileByHandle(query.authorHandle);
    if (!author) throw errors.notFound('profile');
    authorId = author.user_id;
  }

  const { rows, hasMore } = await repo.listFeed({
    scopes: visibilityScopesFor(actor),
    pinnedNow,
    limit: query.limit,
    cursor:
      cursor?.kind === 'rank'
        ? { score: cursor.s, id: cursor.id }
        : cursor?.kind === 'time'
          ? { createdAt: cursor.t, id: cursor.id }
          : null,
    ordering,
    /*
     * Mutes apply to the ambient feed and not to a feed the reader has narrowed
     * themselves. Opening a muted group's page, or a muted author's profile, is
     * an explicit request — honouring the mute there would render the screen
     * empty with no explanation, which reads as a bug rather than as a setting.
     * Saved items are the reader's own shelf and are never filtered.
     */
    applyMutes:
      query.scope !== 'saved' &&
      query.scope !== 'author' &&
      query.groupId === undefined &&
      query.communityId === undefined,
    filters: {
      authorId,
      courseId: query.courseId,
      topicId: query.topicId,
      communityId: query.communityId,
      groupId: query.groupId,
      bookmarkedBy: query.scope === 'saved' ? actor.userId : undefined,
    },
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          ordering === 'rank'
            ? { kind: 'rank', n: pinnedNow.getTime(), s: Number(last.score), id: last.id }
            : { kind: 'time', t: last.created_at.getTime(), id: last.id },
        )
      : null;

  return { items: rows.map((row) => toContentItem(row, actor, locale)), nextCursor };
}

// --- interactions -----------------------------------------------------------

/**
 * Every interaction re-checks visibility first.
 *
 * Without it, a student could like, bookmark or comment on content they cannot
 * read simply by guessing an id — and the like count would tell them the id was
 * real.
 */
async function assertVisible(actor: Actor, contentId: string): Promise<void> {
  const ref = await repo.loadContentRef(contentId);
  if (!ref || !canViewContent(actor, ref).allowed) throw errors.notFound('content');
}

export async function setReaction(
  actor: Actor,
  contentId: string,
  kind: ReactionKind,
): Promise<{ reaction: ReactionKind; likeCount: number }> {
  await assertVisible(actor, contentId);
  const likeCount = await withTransaction((client) =>
    repo.setReaction(contentId, actor.userId, kind, client),
  );
  return { reaction: kind, likeCount };
}

export async function removeReaction(
  actor: Actor,
  contentId: string,
): Promise<{ reaction: null; likeCount: number }> {
  await assertVisible(actor, contentId);
  const likeCount = await withTransaction((client) =>
    repo.removeReaction(contentId, actor.userId, client),
  );
  return { reaction: null, likeCount };
}

export async function addBookmark(
  actor: Actor,
  contentId: string,
  collection: string | null,
): Promise<{ hasBookmarked: boolean; bookmarkCount: number }> {
  await assertVisible(actor, contentId);
  const bookmarkCount = await withTransaction((client) =>
    repo.addBookmark(contentId, actor.userId, collection, client),
  );
  return { hasBookmarked: true, bookmarkCount };
}

export async function removeBookmark(
  actor: Actor,
  contentId: string,
): Promise<{ hasBookmarked: boolean; bookmarkCount: number }> {
  await assertVisible(actor, contentId);
  const bookmarkCount = await withTransaction((client) =>
    repo.removeBookmark(contentId, actor.userId, client),
  );
  return { hasBookmarked: false, bookmarkCount };
}

export async function markViewed(
  actor: Actor,
  contentId: string,
  completion: number | null,
): Promise<void> {
  await assertVisible(actor, contentId);
  await withTransaction(async (client) => {
    await repo.recordView(contentId, actor.userId, completion, client);
    await recordAnalytics('post_viewed', actor.userId, { contentId }, client);
  });
}
