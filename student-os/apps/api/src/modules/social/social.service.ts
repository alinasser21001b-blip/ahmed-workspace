import type {
  CreateReportRequest,
  Locale,
  ProfileSummary,
  Relationship,
} from '@sos/contracts';
import {
  canViewProfile,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors, PG_FOREIGN_KEY_VIOLATION, pgErrorCode } from '../../platform/errors.js';
import { recordAnalytics } from '../analytics/events.service.js';
import * as users from '../users/users.repository.js';
import * as repo from './social.repository.js';

/**
 * Social graph and reporting business logic.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toSummary(row: repo.ProfileSummaryRow, locale: Locale): ProfileSummary {
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    verificationLevel: row.verification_level,
    stageName: localised(row.stage_name_ar, row.stage_name_en, locale),
    collegeName: localised(row.college_name_ar, row.college_name_en, locale),
  };
}

/** Resolves a handle to a user the actor is actually allowed to see. */
async function resolveVisibleTarget(actor: Actor, handle: string): Promise<string> {
  const profile = await users.findProfileByHandle(handle);
  if (!profile) throw errors.notFound('profile');

  const target = await users.loadTargetUserRef(profile.user_id, actor.userId);
  if (!target || !canViewProfile(actor, target).allowed) throw errors.notFound('profile');

  return profile.user_id;
}

async function relationshipFor(actor: Actor, targetId: string): Promise<Relationship> {
  const row = await repo.getRelationship(actor.userId, targetId);
  return {
    userId: targetId,
    isFollowing: row?.is_following ?? false,
    isFollowedBy: row?.is_followed_by ?? false,
    isBlocked: row?.is_blocked ?? false,
    isMuted: row?.is_muted ?? false,
    followerCount: row?.follower_count ?? 0,
  };
}

export async function followByHandle(actor: Actor, handle: string): Promise<Relationship> {
  const targetId = await resolveVisibleTarget(actor, handle);
  if (targetId === actor.userId) throw errors.conflict('You cannot follow yourself.');

  await withTransaction(async (client) => {
    const created = await repo.follow(actor.userId, targetId, client);
    if (created) {
      await recordAnalytics('user_followed', actor.userId, { targetId }, client);
    }
  });

  return relationshipFor(actor, targetId);
}

export async function unfollowByHandle(actor: Actor, handle: string): Promise<Relationship> {
  const profile = await users.findProfileByHandle(handle);
  if (!profile) throw errors.notFound('profile');

  // Unfollowing deliberately skips the visibility check: a user who has since
  // become invisible (privacy tightened, or they blocked you) must still be
  // removable from your following list.
  await withTransaction((client) => repo.unfollow(actor.userId, profile.user_id, client));
  return relationshipFor(actor, profile.user_id);
}

/**
 * Blocks a user.
 *
 * Like unfollow, this does not require the target to be visible — you must be
 * able to block someone who has already made themselves invisible to you.
 */
export async function blockByHandle(
  actor: Actor,
  handle: string,
  reason: string | null,
): Promise<Relationship> {
  const profile = await users.findProfileByHandle(handle);
  if (!profile) throw errors.notFound('profile');
  if (profile.user_id === actor.userId) throw errors.conflict('You cannot block yourself.');

  await withTransaction(async (client) => {
    await repo.block(actor.userId, profile.user_id, reason, client);
    await recordAnalytics('user_blocked', actor.userId, { targetId: profile.user_id }, client);
  });

  return relationshipFor(actor, profile.user_id);
}

export async function unblockByHandle(actor: Actor, handle: string): Promise<Relationship> {
  const profile = await users.findProfileByHandle(handle);
  if (!profile) throw errors.notFound('profile');

  await withTransaction((client) => repo.unblock(actor.userId, profile.user_id, client));
  return relationshipFor(actor, profile.user_id);
}

export async function getRelationshipByHandle(
  actor: Actor,
  handle: string,
): Promise<Relationship> {
  const targetId = await resolveVisibleTarget(actor, handle);
  return relationshipFor(actor, targetId);
}

export async function muteTarget(
  actor: Actor,
  input: { targetType: string; targetId: string; expiresAt?: string | null | undefined },
): Promise<void> {
  await withTransaction((client) =>
    repo.mute(
      actor.userId,
      input.targetType,
      input.targetId,
      input.expiresAt ? new Date(input.expiresAt) : null,
      client,
    ),
  );
}

export async function unmuteTarget(
  actor: Actor,
  input: { targetType: string; targetId: string },
): Promise<void> {
  await withTransaction((client) =>
    repo.unmute(actor.userId, input.targetType, input.targetId, client),
  );
}

export async function listFollows(
  actor: Actor,
  handle: string,
  direction: 'followers' | 'following',
  query: { cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<{ items: ProfileSummary[]; nextCursor: string | null }> {
  const targetId = await resolveVisibleTarget(actor, handle);

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
  const list = direction === 'followers' ? repo.listFollowers : repo.listFollowing;

  const rows = await list(
    targetId,
    excluded,
    cursor?.kind === 'time' ? { createdAt: cursor.t, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toSummary(row, locale)),
    nextCursor:
      hasMore && last
        ? encodeCursor({ kind: 'time', t: last.created_at.getTime(), id: last.user_id })
        : null,
  };
}

/**
 * Files a report (§39).
 *
 * A repeat report on the same target is accepted and deduplicated rather than
 * rejected: telling a user "you already reported this" is fine, but failing
 * their action teaches them the feature is broken. The moderation queue sees
 * one entry either way.
 */
export async function createReport(
  actor: Actor,
  input: CreateReportRequest,
): Promise<{ id: string; status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; createdAt: string }> {
  if (await repo.hasOpenReport(actor.userId, input.targetType, input.targetId)) {
    throw errors.conflict('You have already reported this.', { field: 'targetId' });
  }

  const created = await withTransaction(async (client) => {
    let row;
    try {
      row = await repo.insertReport(
        {
          reporterId: actor.userId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          details: input.details ?? null,
        },
        client,
      );
    } catch (error) {
      // The target id does not exist. 404 rather than a 500 from the FK.
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) throw errors.notFound('report_target');
      throw error;
    }
    if (!row) throw errors.validation([{ path: 'targetType', message: 'Unsupported target type.' }]);

    await recordAnalytics(
      'content_reported',
      actor.userId,
      { targetType: input.targetType, reason: input.reason },
      client,
    );
    return row;
  });

  return {
    id: created.id,
    status: created.status as 'open',
    createdAt: created.created_at.toISOString(),
  };
}
