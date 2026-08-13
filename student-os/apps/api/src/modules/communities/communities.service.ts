import type { Community, ContainerViewerState, Locale } from '@sos/contracts';
import {
  canJoinCommunity,
  canPostInCommunity,
  canViewCommunity,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  isPlatformAdmin,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import { recordAnalytics } from '../analytics/events.service.js';
import * as repo from './communities.repository.js';

/**
 * Communities.
 *
 * Deliberately smaller than groups. A community is an official, cohort-scoped
 * discovery surface with no owner, no invitations and no approval queue — the
 * academic hierarchy already decides who belongs, so there is nothing for a
 * moderator to approve. Groups are where students self-organise; communities
 * are where the institution's structure appears.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toCommunity(row: repo.CommunityRow, actor: Actor, locale: Locale): Community {
  const membership = repo.toMembership(row);
  const join = canJoinCommunity(actor, repo.toRef(row), membership);

  const viewer: ContainerViewerState = {
    membershipStatus: membership?.status ?? null,
    role: membership?.role ?? null,
    joinOutcome: join.allowed ? 'joined' : 'blocked',
    canJoin: join.allowed,
    canPost: canPostInCommunity(actor, membership).allowed,
    // No self-service moderation in V1; only platform admins act on a
    // community, through the admin surface.
    canModerate: isPlatformAdmin(actor),
    canManage: isPlatformAdmin(actor),
  };

  return {
    id: row.id,
    slug: row.slug,
    name: localised(row.name_ar, row.name_en, locale) ?? row.slug,
    description: row.description,
    coverUrl: row.cover_url,
    visibility: row.visibility,
    isOfficial: row.is_official,
    memberCount: row.member_count,
    courseId: row.course_id,
    courseName: localised(row.course_name_ar, row.course_name_en, locale),
    viewer,
  };
}

export async function getCommunity(
  actor: Actor,
  communityId: string,
  locale: Locale,
): Promise<Community> {
  const row = await repo.findById(communityId, actor.userId);
  if (!row) throw errors.notFound('community');
  if (!canViewCommunity(actor, repo.toRef(row)).allowed) throw errors.notFound('community');
  return toCommunity(row, actor, locale);
}

export async function listCommunities(
  actor: Actor,
  query: { scope: 'mine' | 'discover'; cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<{ items: Community[]; nextCursor: string | null }> {
  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const scopes = visibilityScopesFor(actor);
  const rows = await repo.listCommunities(
    query.scope,
    {
      userId: actor.userId,
      universityId: scopes.universityId,
      collegeId: scopes.collegeId,
      stageId: scopes.stageId,
      courseIds: scopes.courseIds,
    },
    cursor?.kind === 'time' ? { createdAt: cursor.t, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toCommunity(row, actor, locale)),
    nextCursor:
      hasMore && last
        ? encodeCursor({ kind: 'time', t: last.created_at.getTime(), id: last.id })
        : null,
  };
}

export async function joinCommunity(
  actor: Actor,
  communityId: string,
  locale: Locale,
): Promise<Community> {
  const row = await repo.findById(communityId, actor.userId);
  if (!row) throw errors.notFound('community');
  if (!canViewCommunity(actor, repo.toRef(row)).allowed) throw errors.notFound('community');

  const decision = canJoinCommunity(actor, repo.toRef(row), repo.toMembership(row));
  if (!decision.allowed) {
    throw errors.conflict('You cannot join this community.', { reason: decision.reason });
  }

  await withTransaction(async (client) => {
    await repo.upsertMembership(communityId, actor.userId, 'active', client);
    await recordAnalytics('community_joined', actor.userId, { communityId }, client);
  });

  return getCommunity(actor, communityId, locale);
}

export async function leaveCommunity(actor: Actor, communityId: string): Promise<void> {
  await withTransaction((client) =>
    repo.upsertMembership(communityId, actor.userId, 'left', client),
  );
}
