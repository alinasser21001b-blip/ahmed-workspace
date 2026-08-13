import type {
  ContainerViewerState,
  CreateGroupRequest,
  Group,
  GroupMember,
  Locale,
  MembershipStatus,
} from '@sos/contracts';
import {
  canDiscoverGroup,
  canJoinGroup,
  canManageGroup,
  canModerateGroup,
  canPostInGroup,
  canRemoveMember,
  canTransferOwnership,
  canViewGroup,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import { recordAnalytics } from '../analytics/events.service.js';
import * as users from '../users/users.repository.js';
import * as repo from './groups.repository.js';

/**
 * Group business logic.
 *
 * Every read resolves the group, then asks the policy, then returns 404 when
 * refused. 404 rather than 403 throughout: an unlisted group must not confirm
 * its own existence to someone who guessed its id.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toViewerState(actor: Actor, row: repo.GroupRow): ContainerViewerState {
  const membership = repo.toMembership(row);
  const join = canJoinGroup(actor, repo.toGroupRef(row), membership);

  return {
    membershipStatus: membership?.status ?? null,
    role: membership?.role ?? null,
    joinOutcome: join.outcome,
    canJoin: join.allowed,
    canPost: canPostInGroup(actor, membership).allowed,
    canModerate: canModerateGroup(actor, membership).allowed,
    canManage: canManageGroup(actor, membership).allowed,
  };
}

function toGroup(row: repo.GroupRow, actor: Actor, locale: Locale): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    visibility: row.visibility,
    joinPolicy: row.join_policy,
    memberCount: row.member_count,
    maxMembers: row.max_members,
    communityId: row.community_id,
    communityName: localised(row.community_name_ar, row.community_name_en, locale),
    courseId: row.course_id,
    courseName: localised(row.course_name_ar, row.course_name_en, locale),
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
    viewer: toViewerState(actor, row),
    pendingRequestCount: row.pending_request_count,
  };
}

/** Loads a group the actor is allowed to know exists. */
async function loadVisibleGroup(actor: Actor, groupId: string): Promise<repo.GroupRow> {
  const row = await repo.findGroupById(groupId, actor.userId);
  if (!row) throw errors.notFound('group');

  if (!canViewGroup(actor, repo.toGroupRef(row), repo.toMembership(row)).allowed) {
    throw errors.notFound('group');
  }
  return row;
}

export async function getGroup(actor: Actor, groupId: string, locale: Locale): Promise<Group> {
  return toGroup(await loadVisibleGroup(actor, groupId), actor, locale);
}

/**
 * Creates a group with the founder as owner.
 *
 * The academic placement is copied from the founder's profile, not taken from
 * the request — otherwise a student could found a group scoped to a cohort they
 * do not belong to and then invite themselves an audience.
 */
export async function createGroup(
  actor: Actor,
  input: CreateGroupRequest,
  locale: Locale,
): Promise<Group> {
  if (actor.status !== 'active') throw errors.accountSuspended(actor.status);

  const profile = await users.findProfileByUserId(actor.userId);
  if (!profile?.onboarding_completed) {
    throw errors.preconditionFailed('Complete your profile before creating a group.', {
      field: 'onboarding',
    });
  }

  if (input.courseId && !actor.courseIds.has(input.courseId)) {
    throw errors.forbidden('not_enrolled');
  }
  if (input.communityId && !actor.communityIds.has(input.communityId)) {
    throw errors.forbidden('not_community_member');
  }
  // A scope the founder cannot satisfy would produce a group nobody, including
  // its owner, could discover.
  if (input.visibility === 'course' && !input.courseId) {
    throw errors.validation([
      { path: 'courseId', message: 'A course-scoped group needs a course.' },
    ]);
  }
  if (input.visibility === 'community' && !input.communityId) {
    throw errors.validation([
      { path: 'communityId', message: 'A community-scoped group needs a community.' },
    ]);
  }

  const groupId = await withTransaction(async (client) => {
    const created = await repo.insertGroup(
      {
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        joinPolicy: input.joinPolicy,
        maxMembers: input.maxMembers,
        communityId: input.communityId ?? null,
        courseId: input.courseId ?? null,
        createdBy: actor.userId,
        universityId: profile.university_id,
        collegeId: profile.college_id,
        stageId: profile.stage_id,
      },
      client,
    );

    // The founder's membership is inserted directly rather than through
    // `upsertMembership`, because `insertGroup` already seeded member_count = 1
    // — counting them twice would put every new group at two members.
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [created.id, actor.userId],
    );

    await recordAnalytics(
      'group_created',
      actor.userId,
      { groupId: created.id, visibility: input.visibility, joinPolicy: input.joinPolicy },
      client,
    );
    return created.id;
  });

  return getGroup(actor, groupId, locale);
}

export async function updateGroup(
  actor: Actor,
  groupId: string,
  input: Parameters<typeof repo.updateGroup>[1],
  locale: Locale,
): Promise<Group> {
  const row = await loadVisibleGroup(actor, groupId);
  const decision = canManageGroup(actor, repo.toMembership(row));
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  await withTransaction((client) => repo.updateGroup(groupId, input, client));
  return getGroup(actor, groupId, locale);
}

export async function archiveGroup(actor: Actor, groupId: string): Promise<void> {
  const row = await loadVisibleGroup(actor, groupId);
  const decision = canManageGroup(actor, repo.toMembership(row));
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  await withTransaction(async (client) => {
    await repo.archiveGroup(groupId, client);
    await recordAnalytics('group_archived', actor.userId, { groupId }, client);
  });
}

/**
 * Joins a group, or files a request.
 *
 * The policy decides which of the two happens, and the response reports it —
 * the client renders the outcome rather than assuming the button worked.
 */
export async function joinGroup(
  actor: Actor,
  groupId: string,
  message: string | null,
  locale: Locale,
): Promise<{ status: MembershipStatus; group: Group }> {
  const row = await repo.findGroupById(groupId, actor.userId);
  if (!row) throw errors.notFound('group');

  const membership = repo.toMembership(row);
  // Visibility first: an unlisted group must 404 rather than explain itself.
  if (!canViewGroup(actor, repo.toGroupRef(row), membership).allowed) {
    throw errors.notFound('group');
  }

  const decision = canJoinGroup(actor, repo.toGroupRef(row), membership);
  if (!decision.allowed) throw errors.conflict(joinFailureMessage(decision.reason), {
    reason: decision.reason,
  });

  const status: MembershipStatus = decision.outcome === 'joined' ? 'active' : 'pending';

  await withTransaction(async (client) => {
    await repo.upsertMembership(
      { groupId, userId: actor.userId, role: 'member', status, message },
      client,
    );
    await recordAnalytics(
      status === 'active' ? 'group_joined' : 'group_join_requested',
      actor.userId,
      { groupId },
      client,
    );
  });

  return { status, group: await getGroup(actor, groupId, locale) };
}

export async function leaveGroup(actor: Actor, groupId: string): Promise<void> {
  const row = await loadVisibleGroup(actor, groupId);
  const membership = repo.toMembership(row);
  if (!membership) throw errors.conflict('You are not a member of this group.');

  // An owner leaving would strand the group with no one able to manage it.
  if (membership.role === 'owner' && row.member_count > 1) {
    throw errors.preconditionFailed(
      'Transfer ownership before leaving, or archive the group.',
      { field: 'role' },
    );
  }

  await withTransaction(async (client) => {
    await repo.removeMembership(groupId, actor.userId, 'left', client);
    // A departing sole owner leaves nothing behind worth keeping open.
    if (membership.role === 'owner') await repo.archiveGroup(groupId, client);
    await recordAnalytics('group_left', actor.userId, { groupId }, client);
  });
}

// --- membership management --------------------------------------------------

export async function listMembers(
  actor: Actor,
  groupId: string,
  query: { status: MembershipStatus; cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<{ items: GroupMember[]; nextCursor: string | null }> {
  const row = await loadVisibleGroup(actor, groupId);
  const membership = repo.toMembership(row);

  // The member list is for members. A discoverable group shows its size, not
  // its roster — otherwise "who is in this study group" is public information
  // about other students.
  if (membership?.status !== 'active' && !canModerateGroup(actor, membership).allowed) {
    throw errors.forbidden('not_group_member');
  }
  // Pending requests are a moderation queue, not a member list.
  if (query.status !== 'active' && !canModerateGroup(actor, membership).allowed) {
    throw errors.forbidden('not_group_moderator');
  }

  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const rows = await repo.listMembers(
    groupId,
    query.status,
    visibilityScopesFor(actor).excludedUserIds,
    cursor?.kind === 'time' ? { createdAt: cursor.t, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((member) => ({
      profile: {
        userId: member.user_id,
        handle: member.handle,
        displayName: member.display_name,
        avatarUrl: member.avatar_url,
        verificationLevel: member.verification_level,
        stageName: localised(member.stage_name_ar, member.stage_name_en, locale),
        collegeName: localised(member.college_name_ar, member.college_name_en, locale),
      },
      role: member.role,
      status: member.status,
      joinedAt: member.joined_at?.toISOString() ?? null,
      requestedAt: member.requested_at?.toISOString() ?? null,
      message: member.message,
    })),
    nextCursor:
      hasMore && last?.joined_at
        ? encodeCursor({ kind: 'time', t: last.joined_at.getTime(), id: last.user_id })
        : null,
  };
}

/** Approves a request, promotes, demotes, or bans. */
export async function updateMember(
  actor: Actor,
  groupId: string,
  targetHandle: string,
  input: { role?: 'member' | 'moderator' | 'admin' | 'owner'; status?: 'active' | 'banned' },
): Promise<void> {
  const row = await loadVisibleGroup(actor, groupId);
  const actorMembership = repo.toMembership(row);

  const target = await users.findProfileByHandle(targetHandle);
  if (!target) throw errors.notFound('profile');

  const targetMembership = await repo.findMembership(groupId, target.user_id);
  if (!targetMembership) throw errors.notFound('membership');

  if (input.role === 'owner') {
    const decision = canTransferOwnership(actor, actorMembership, targetMembership);
    if (!decision.allowed) throw errors.forbidden(decision.reason);

    await withTransaction((client) =>
      repo.transferOwnership(groupId, actor.userId, target.user_id, client),
    );
    return;
  }

  if (input.status === 'banned') {
    const decision = canRemoveMember(actor, actorMembership, targetMembership, target.user_id);
    if (!decision.allowed) throw errors.forbidden(decision.reason);

    await withTransaction((client) =>
      repo.removeMembership(groupId, target.user_id, 'banned', client),
    );
    return;
  }

  const moderate = canModerateGroup(actor, actorMembership);
  if (!moderate.allowed) throw errors.forbidden(moderate.reason);

  // Promotion is a management action, not a moderation one: a moderator must
  // not be able to mint more moderators.
  if (input.role && input.role !== 'member') {
    const manage = canManageGroup(actor, actorMembership);
    if (!manage.allowed) throw errors.forbidden(manage.reason);
  }

  await withTransaction((client) =>
    repo.upsertMembership(
      {
        groupId,
        userId: target.user_id,
        role: input.role ?? targetMembership.role,
        status: input.status ?? targetMembership.status,
      },
      client,
    ),
  );
}

export async function removeMember(
  actor: Actor,
  groupId: string,
  targetHandle: string,
): Promise<void> {
  const row = await loadVisibleGroup(actor, groupId);
  const actorMembership = repo.toMembership(row);

  const target = await users.findProfileByHandle(targetHandle);
  if (!target) throw errors.notFound('profile');

  const targetMembership = await repo.findMembership(groupId, target.user_id);
  if (!targetMembership) throw errors.notFound('membership');

  const decision = canRemoveMember(actor, actorMembership, targetMembership, target.user_id);
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  await withTransaction((client) => repo.removeMembership(groupId, target.user_id, 'left', client));
}

export async function inviteMember(
  actor: Actor,
  groupId: string,
  handle: string,
): Promise<void> {
  const row = await loadVisibleGroup(actor, groupId);
  const decision = canManageGroup(actor, repo.toMembership(row));
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  const target = await users.findProfileByHandle(handle);
  if (!target) throw errors.notFound('profile');

  const existing = await repo.findMembership(groupId, target.user_id);
  if (existing?.status === 'active') throw errors.conflict('That student is already a member.');
  if (existing?.status === 'banned') throw errors.conflict('That student is banned from this group.');

  await withTransaction(async (client) => {
    await repo.upsertMembership(
      {
        groupId,
        userId: target.user_id,
        role: 'member',
        status: 'invited',
        invitedBy: actor.userId,
      },
      client,
    );
    await recordAnalytics('group_invite_sent', actor.userId, { groupId }, client);
  });
}

// --- listing ----------------------------------------------------------------

export async function listGroups(
  actor: Actor,
  query: {
    scope: 'mine' | 'discover';
    communityId?: string | undefined;
    courseId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
  locale: Locale,
): Promise<{ items: Group[]; nextCursor: string | null }> {
  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw errors.validation([{ path: 'cursor', message: 'The pagination cursor is invalid.' }]);
    }
    throw error;
  }

  const keyset = cursor?.kind === 'time' ? { createdAt: cursor.t, id: cursor.id } : null;
  const scopes = visibilityScopesFor(actor);

  const rows =
    query.scope === 'mine'
      ? await repo.listMyGroups(actor.userId, keyset, query.limit)
      : await repo.listDiscoverableGroups(
          {
            userId: actor.userId,
            universityId: scopes.universityId,
            collegeId: scopes.collegeId,
            stageId: scopes.stageId,
            courseIds: scopes.courseIds,
            communityIds: scopes.communityIds,
          },
          { communityId: query.communityId, courseId: query.courseId },
          keyset,
          query.limit,
        );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  /*
   * Defence in depth. The discovery query already implements
   * `canDiscoverGroup`, but running the policy over the result as well means a
   * divergence between the two shows up as a missing row rather than as a leak.
   * Cheap at page size, and it is the direction of failure we want.
   */
  const visible = page.filter((row) =>
    query.scope === 'mine'
      ? true
      : canDiscoverGroup(actor, repo.toGroupRef(row), repo.toMembership(row)).allowed,
  );

  const last = page[page.length - 1];
  return {
    items: visible.map((row) => toGroup(row, actor, locale)),
    nextCursor:
      hasMore && last
        ? encodeCursor({ kind: 'time', t: last.created_at.getTime(), id: last.id })
        : null,
  };
}

function joinFailureMessage(reason: string): string {
  switch (reason) {
    case 'group_full':
      return 'This group is full.';
    case 'invite_only':
      return 'This group is invite-only.';
    case 'already_a_member':
      return 'You are already a member.';
    case 'request_already_pending':
      return 'Your request is already pending.';
    case 'group_archived':
      return 'This group has been archived.';
    case 'banned_from_group':
      return 'You cannot join this group.';
    default:
      return 'You cannot join this group.';
  }
}
